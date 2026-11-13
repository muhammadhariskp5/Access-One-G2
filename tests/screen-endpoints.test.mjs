// Small per-screen endpoints that replaced reading the full lists in the browser:
// application roster, linked supplementary passes, employee detail scoping, re-adding a deleted person.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin;

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO locations (id, name, code, organizationId) VALUES ('L1', 'Alpha Gate', 'AG', '${H}'), ('L2', 'Zulu Yard', 'ZY', '${H}')`);
  db.run(`INSERT INTO employees (id, name, employeeId, qatarId, jobTitle, department, organizationId) VALUES
    ('E1', 'Zara Young', 'Z-1', 'Q111', 'Rigger', 'Ops', '${H}'), ('E2', 'Adam Bell', 'A-2', NULL, NULL, NULL, '${H}'),
    ('E9', 'Other Org', 'X-9', NULL, NULL, NULL, 'org-elsewhere')`);
  db.run(`INSERT INTO passRequests (id, locationId, status, employeeIds, organizationId, createdAt) VALUES
    ('APP1', 'L1', 'processing', '["E1","E2"]', '${H}', '2026-10-01')`);
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, type, status, passNumber, parentPassId, expiryDate, organizationId, createdAt) VALUES
    ('P0', 'APP1', 'E1', 'L1', 'main', 'issued', 'PN-0', NULL, '2027-01-01', '${H}', '2026-10-02'),
    ('P1', 'APP1', 'E1', 'L1', 'main', 'active', 'PN-1', NULL, '2027-06-30', '${H}', '2026-10-05'),
    ('S1', NULL, 'E1', 'L2', 'supplementary', 'active', 'SN-1', 'P1', NULL, '${H}', '2026-10-06'),
    ('S2', NULL, 'E1', 'L2', 'supplementary', 'revoked', 'SN-2', 'P1', NULL, '${H}', '2026-10-06'),
    ('S3', NULL, 'E2', 'L2', 'supplementary', 'active', 'SN-3', NULL, NULL, '${H}', '2026-10-06')`);
  db.run(`DELETE FROM passRequestEmployees`);
  db.run(`DELETE FROM schemaMigrations WHERE id = '2026-11-13-pass-list-expiry-and-indexes'`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'scradmin@test.local', password: 'ScrAdminPass1', displayName: 'Scr Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  admin = client(srv.base);
  assert.equal((await admin.login('scradmin@test.local', 'ScrAdminPass1')).status, 200);
});
after(async () => { await srv?.stop(); });

test('roster: everyone on the application, with details and their latest pass on it', async () => {
  const r = await admin.get('/api/passApplications/app1/roster');   // any letter case
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const byId = Object.fromEntries(r.body.map(x => [x.employeeId, x]));
  assert.equal(byId.E1.name, 'Zara Young');
  assert.equal(byId.E1.department, 'Ops');
  assert.equal(byId.E1.pass.id, 'P1');               // newest of P0 / P1
  assert.equal(byId.E1.pass.passNumber, 'PN-1');
  assert.equal(byId.E2.pass, null);
  assert.equal((await admin.get('/api/passApplications/NOPE/roster')).status, 404);
});

test('linked supplementary: by parent link and, for a main pass, by person; live ones only', async () => {
  const r = await admin.post('/api/passes/linked-supplementary', { ids: ['P1'] });
  assert.deepEqual(r.body.map(p => p.id).sort(), ['S1']);
  assert.equal(r.body[0].employeeName, 'Zara Young');
  assert.equal(r.body[0].locationName, 'Zulu Yard');
  assert.deepEqual((await admin.post('/api/passes/linked-supplementary', { ids: ['virtual-APP1-E2'] })).body, []);
});

test('employee detail is scoped to the organization and hides deleted people', async () => {
  const r = await admin.get('/api/employees/E1');
  assert.equal(r.status, 200);
  assert.ok(Array.isArray(r.body.passes) && Array.isArray(r.body.requests));
  assert.equal((await admin.get('/api/employees/E9')).status, 404);
});

test('a deleted employee can be added again with the same code', async () => {
  assert.equal((await admin.del('/api/employees/E2')).status, 200);
  assert.equal((await admin.get('/api/employees/E2')).status, 404);
  const again = await admin.post('/api/employees', { firstName: 'Adam', lastName: 'Bell', name: 'Adam Bell', employeeId: 'A-2', qidVisaNumber: 'QV-NEW-2' });
  assert.equal(again.status, 200, JSON.stringify(again.body));
  const dup = await admin.post('/api/employees', { firstName: 'Adam', lastName: 'Bell', name: 'Adam Bell', employeeId: 'A-2', qidVisaNumber: 'QV-NEW-3' });
  assert.equal(dup.status, 400);                      // a live duplicate is still refused
});
