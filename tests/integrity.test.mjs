// Referential integrity: the orphan report, case repair, soft deletes for users / access codes,
// identity fields taken from the session, and the link sync never creating dangling rows.
// (Foreign-key DDL itself is Oracle-only; SQLite reports constraints as 'not-supported'.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, OWNER } from './helpers.mjs';

let srv, owner, ownerId, locationId, empId, appId, passId;

async function login() {
  owner = client(srv.base);
  const r = await owner.login(OWNER.email, OWNER.password);
  assert.equal(r.status, 200);
  ownerId = r.body.id;
}
async function restartWith(seed) {
  await srv.stop();
  const db = await openDb(srv.dbPath);
  seed(db);
  db.save();
  srv = await startServer({ dbPath: srv.dbPath });
  await login();
}
const report = async () => (await owner.get('/api/platform/integrity')).body;
const rel = (r, name) => r.relations.find(x => x.name === name);

before(async () => {
  srv = await startServer();
  await login();
  locationId = (await owner.post('/api/locations', { name: 'Gate I', code: 'GI' })).body.id;
  empId = (await owner.post('/api/employees', { firstName: 'Int', lastName: 'Egrity', name: 'Int Egrity', employeeId: 'INT-1', organizationId: 'org-habari' })).body.id;
  const created = await owner.post('/api/passApplications', { employeeIds: [empId], locationId, endDate: '2030-01-01', requesterId: 'someone-else' });
  assert.equal(created.status, 200, JSON.stringify(created.body) + srv.output().slice(-2500));
  appId = created.body.id;
  passId = (await owner.post('/api/passes', { employeeId: empId, locationId, type: 'main', status: 'active', expiryDate: '2030-01-01' })).body.id;
});
after(async () => { await srv?.stop(); });

test('a clean database reports no dangling references', async () => {
  const r = await report();
  assert.equal(r.clean, true, JSON.stringify(r.relations.filter(x => x.orphans || x.error)));
  assert.equal(r.orphans, 0);
  assert.ok(r.relations.every(x => x.constraint === 'not-supported'));
  assert.ok(r.relations.some(x => x.group === 'People') && r.relations.some(x => x.group === 'Organizations'));
});

test('the requester comes from the session, not the request body', async () => {
  const apps = (await owner.get('/api/passApplications')).body;
  assert.equal(apps.find(a => a.id === appId).requesterId, ownerId);
});

test('the system account exists, cannot sign in and is not listed', async () => {
  const users = (await owner.get('/api/users?includePlatformAdmin=true')).body;
  assert.equal(users.some(u => u.id === 'system'), false);
  const anon = client(srv.base);
  assert.equal((await anon.login('system@accessone.invalid', 'anything-at-all')).status, 401);
});

test('the report and its actions are power-admin only', async () => {
  const created = await owner.post('/api/users', { email: 'intadmin@test.local', password: 'IntAdminPass1', displayName: 'Int Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  const orgAdmin = client(srv.base);
  assert.equal((await orgAdmin.login('intadmin@test.local', 'IntAdminPass1')).status, 200);
  assert.equal((await orgAdmin.get('/api/platform/integrity')).status, 403);
  assert.equal((await orgAdmin.post('/api/platform/integrity/enforce', {})).status, 403);
  assert.equal((await orgAdmin.post('/api/platform/integrity/repair', {})).status, 403);
});

test('an application naming an unknown employee is rejected', async () => {
  const r = await owner.post('/api/passApplications', { employeeIds: [empId, 'no-such-employee'], locationId, endDate: '2030-01-01' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no-such-employee/);
  const b = await owner.post('/api/passes/batch', { employeeIds: ['no-such-employee'], locationId, type: 'main', expiryDate: '2030-01-01' });
  assert.equal(b.status, 400);
});

test('deleting a user keeps the record, ends their session and frees the email', async () => {
  const created = await owner.post('/api/users', { email: 'leaver@test.local', password: 'LeaverPass12', displayName: 'Leaver', role: 'viewer', organizationId: 'org-habari' });
  const leaverId = created.body.id;
  await owner.patch(`/api/users/${leaverId}`, { status: 'active' });
  const leaver = client(srv.base);
  assert.equal((await leaver.login('leaver@test.local', 'LeaverPass12')).status, 200);

  assert.equal((await owner.del(`/api/users/${leaverId}`)).status, 200);
  assert.equal((await leaver.get('/api/employees')).status, 401, 'open session is refused');
  assert.equal((await client(srv.base).login('leaver@test.local', 'LeaverPass12')).status, 401);
  assert.equal((await owner.get('/api/users')).body.some(u => u.id === leaverId), false);
  const again = await owner.post('/api/users', { email: 'leaver@test.local', password: 'LeaverPass34', displayName: 'Leaver Two', role: 'viewer', organizationId: 'org-habari' });
  assert.equal(again.status, 200, 'email can be used again: ' + JSON.stringify(again.body));

  const r = await report();
  assert.equal(r.clean, true, JSON.stringify(r.relations.filter(x => x.orphans)));
});

test('deleting an access code hides it but keeps the record', async () => {
  const code = (await owner.post('/api/accessCodes', { areaCode: 'AC-INT', accessArea: 'Integrity Gate', locationId })).body;
  assert.ok(code.id, JSON.stringify(code));
  assert.equal((await owner.del(`/api/accessCodes/${code.id}`)).status, 200);
  assert.equal((await owner.get('/api/accessCodes')).body.some(c => c.id === code.id), false);
  await restartWith(db => {
    const [row] = db.rows('SELECT deletedAt FROM accessCodes WHERE id = :id', { ':id': code.id });
    assert.ok(row?.deletedAt, 'row kept with deletedAt');
    const [sys] = db.rows(`SELECT role, status FROM users WHERE id = 'system'`);
    assert.deepEqual({ ...sys }, { role: 'system', status: 'system' }, 'system account row exists');
  });
});

test('dangling references are counted, with case-only mismatches separated', async () => {
  await restartWith(db => {
    const now = new Date().toISOString();
    db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, status, createdAt) VALUES ('orph-1', NULL, 'ghost-emp', :loc, 'active', :now)`, { ':loc': locationId, ':now': now });
    db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, parentPassId, status, createdAt) VALUES ('orph-2', :req, :emp, :loc, :parent, 'active', :now)`,
      { ':req': appId.toLowerCase(), ':emp': empId, ':loc': locationId, ':parent': passId.toUpperCase(), ':now': now });
    db.run(`UPDATE passRequests SET employeeIds = :ids WHERE id = :id`, { ':ids': JSON.stringify([empId, 'ghost-emp']), ':id': appId });
  });
  const r = await report();
  assert.equal(r.clean, false);
  assert.equal(rel(r, 'fk_pass_employee').orphans, 1);
  assert.deepEqual(rel(r, 'fk_pass_employee').samples, [{ id: 'orph-1', ref: 'ghost-emp' }]);
  assert.equal(rel(r, 'fk_pass_employee').caseOnlyMismatches, 0);
  assert.equal(rel(r, 'fk_pass_request').caseOnlyMismatches, 1);
  assert.equal(rel(r, 'fk_pass_parent').caseOnlyMismatches, 1);
  assert.equal(r.repairable, 2);
});

test('case repair re-points mismatches and leaves real orphans alone', async () => {
  const fix = await owner.post('/api/platform/integrity/repair', {});
  assert.equal(fix.status, 200, JSON.stringify(fix.body));
  assert.equal(fix.body.total, 2);
  const r = await report();
  assert.equal(rel(r, 'fk_pass_request').orphans, 0);
  assert.equal(rel(r, 'fk_pass_parent').orphans, 0);
  assert.equal(rel(r, 'fk_pass_employee').orphans, 1, 'a genuinely missing employee is not touched');
  await restartWith(db => {
    const [row] = db.rows(`SELECT requestId, parentPassId FROM passes WHERE id = 'orph-2'`);
    assert.equal(row.requestId, appId);
    assert.equal(row.parentPassId, passId);
  });
});

test('syncing an application never links a missing employee', async () => {
  const r = await owner.patch(`/api/passApplications/${appId}`, { status: 'pending' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(rel(await report(), 'fk_pre_employee').orphans, 0);
  await restartWith(db => {
    const links = db.rows('SELECT employeeId FROM passRequestEmployees WHERE requestId = :id', { ':id': appId });
    assert.deepEqual(links.map(l => l.employeeId), [empId]);
  });
});

test('an application ID typed in another case is stored in its real case', async () => {
  const r = await owner.patch(`/api/passApplications/${appId.toLowerCase()}`, { remarks: 'case test' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const hist = rel(await report(), 'fk_hist_request');
  assert.ok(hist.rows > 0);
  assert.equal(hist.orphans, 0);
});

test('applications whose main pass was erased get the link cleared, with the old ID kept in history', async () => {
  await restartWith(db => {
    const now = new Date().toISOString();
    db.run(`INSERT INTO passRequests (id, status, employeeIds, employeeStatuses, parentPassId, createdAt, updatedAt)
            VALUES ('GONEPARENT', 'completed', '[]', '{}', 'irzkdsxfj', :n, :n)`, { ':n': now });
    db.run(`INSERT INTO passRequests (id, status, employeeIds, employeeStatuses, parentPassId, createdAt, updatedAt)
            VALUES ('CASEPARENT', 'completed', '[]', '{}', :p, :n, :n)`, { ':p': passId.toUpperCase(), ':n': now });
    db.run(`DELETE FROM schemaMigrations WHERE id = '2026-11-13-clear-dangling-main-pass-links'`);
  });
  await restartWith(db => {
    const [gone] = db.rows(`SELECT parentPassId FROM passRequests WHERE id = 'GONEPARENT'`);
    assert.equal(gone.parentPassId, null);
    const [hist] = db.rows(`SELECT userId, action, remarks FROM requestHistory WHERE requestId = 'GONEPARENT'`);
    assert.equal(hist.userId, 'system');
    assert.equal(hist.action, 'DATA_REPAIR');
    assert.match(hist.remarks, /irzkdsxfj/);
    const [kept] = db.rows(`SELECT parentPassId FROM passRequests WHERE id = 'CASEPARENT'`);
    assert.equal(kept.parentPassId, passId.toUpperCase(), 'a pass that exists (case aside) is not cleared');
  });
  assert.equal(rel(await report(), 'fk_req_parent').caseOnlyMismatches, 1);
});
