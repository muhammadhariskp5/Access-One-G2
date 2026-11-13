// Referential integrity: the orphan report, rejecting unknown employees, and the link sync
// never creating dangling rows. (Foreign-key DDL itself is Oracle-only; SQLite reports
// constraints as 'not-supported'.)
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, OWNER } from './helpers.mjs';

let srv, owner, locationId, empId, appId;

async function login() {
  owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
}

before(async () => {
  srv = await startServer();
  await login();
  locationId = (await owner.post('/api/locations', { name: 'Gate I', code: 'GI' })).body.id;
  empId = (await owner.post('/api/employees', { firstName: 'Int', lastName: 'Egrity', name: 'Int Egrity', employeeId: 'INT-1', organizationId: 'org-habari' })).body.id;
  const created = await owner.post('/api/passApplications', { employeeIds: [empId], locationId, endDate: '2030-01-01' });
  assert.equal(created.status, 200, JSON.stringify(created.body) + srv.output().slice(-2500));
  appId = created.body.id;
});
after(async () => { await srv?.stop(); });

test('a clean database reports no orphans', async () => {
  const r = await owner.get('/api/platform/integrity');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.clean, true, JSON.stringify(r.body.relations.filter(x => x.orphans)));
  assert.ok(r.body.relations.every(x => x.constraint === 'not-supported'));
});

test('the report is power-admin only', async () => {
  const created = await owner.post('/api/users', { email: 'intadmin@test.local', password: 'IntAdminPass1', displayName: 'Int Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  const orgAdmin = client(srv.base);
  assert.equal((await orgAdmin.login('intadmin@test.local', 'IntAdminPass1')).status, 200);
  assert.equal((await orgAdmin.get('/api/platform/integrity')).status, 403);
  assert.equal((await orgAdmin.post('/api/platform/integrity/enforce', {})).status, 403);
});

test('an application naming an unknown employee is rejected', async () => {
  const r = await owner.post('/api/passApplications', { employeeIds: [empId, 'no-such-employee'], locationId, endDate: '2030-01-01' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /no-such-employee/);
  const b = await owner.post('/api/passes/batch', { employeeIds: ['no-such-employee'], locationId, type: 'main', expiryDate: '2030-01-01' });
  assert.equal(b.status, 400);
});

test('orphans are counted, with case-only mismatches separated', async () => {
  await srv.stop();
  const db = await openDb(srv.dbPath);
  const now = new Date().toISOString();
  // A pass for an employee that doesn't exist, and one pointing at the application in lower case.
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, status, createdAt) VALUES ('orph-1', NULL, 'ghost-emp', :loc, 'active', :now)`, { ':loc': locationId, ':now': now });
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, status, createdAt) VALUES ('orph-2', :req, :emp, :loc, 'active', :now)`, { ':req': appId.toLowerCase(), ':emp': empId, ':loc': locationId, ':now': now });
  // An old application whose JSON still names a missing employee.
  db.run(`UPDATE passRequests SET employeeIds = :ids WHERE id = :id`, { ':ids': JSON.stringify([empId, 'ghost-emp']), ':id': appId });
  db.save();
  srv = await startServer({ dbPath: srv.dbPath });
  await login();

  const r = (await owner.get('/api/platform/integrity')).body;
  assert.equal(r.clean, false);
  const byName = Object.fromEntries(r.relations.map(x => [x.name, x]));
  assert.equal(byName.fk_pass_employee.orphans, 1);
  assert.deepEqual(byName.fk_pass_employee.samples, [{ id: 'orph-1', ref: 'ghost-emp' }]);
  assert.equal(byName.fk_pass_request.orphans, 1);
  assert.equal(byName.fk_pass_request.caseOnlyMismatches, 1);
});

test('syncing an application never links a missing employee', async () => {
  const r = await owner.patch(`/api/passApplications/${appId}`, { status: 'pending' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const report = (await owner.get('/api/platform/integrity')).body;
  const pre = report.relations.find(x => x.name === 'fk_pre_employee');
  assert.equal(pre.orphans, 0);
  await srv.stop();
  const db = await openDb(srv.dbPath);
  const links = db.rows('SELECT employeeId FROM passRequestEmployees WHERE requestId = :id', { ':id': appId });
  assert.deepEqual(links.map(l => l.employeeId), [empId]);
  srv = await startServer({ dbPath: srv.dbPath });
});
