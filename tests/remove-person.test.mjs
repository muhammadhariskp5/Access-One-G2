// Removing a person from an application after their pass was issued: the pass ends with them
// (cancelled, kept for history, hidden from lists), linked supplementary passes are cancelled, and
// the workspace shows no nameless leftover row.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin, passes;

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO locations (id, name, code, organizationId) VALUES ('L1', 'Alpha Gate', 'AG', '${H}'), ('L2', 'Zulu Yard', 'ZY', '${H}')`);
  db.run(`INSERT INTO employees (id, name, employeeId, status, organizationId) VALUES
    ('E1', 'Keep Me', 'K-1', 'active', '${H}'), ('E2', 'Remove Me', 'R-2', 'active', '${H}')`);
  db.run(`INSERT INTO passRequests (id, locationId, status, type, employeeIds, employeeStatuses, organizationId, createdAt) VALUES
    ('APP1', 'L1', 'issued', 'main', '["E1","E2"]', '{"E1":"issued","E2":"issued"}', '${H}', '2026-10-01')`);
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, type, status, parentPassId, organizationId, createdAt) VALUES
    ('P1', 'APP1', 'E1', 'L1', 'main', 'issued', NULL, '${H}', '2026-10-02'),
    ('P2', 'APP1', 'E2', 'L1', 'main', 'issued', NULL, '${H}', '2026-10-02'),
    ('S2', NULL, 'E2', 'L2', 'supplementary', 'active', 'P2', '${H}', '2026-10-03')`);
  db.run(`DELETE FROM passRequestEmployees`);
  db.run(`DELETE FROM schemaMigrations WHERE id = '2026-11-14-link-table-people'`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'rmadmin@test.local', password: 'RmAdminPass1', displayName: 'Rm Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  admin = client(srv.base);
  assert.equal((await admin.login('rmadmin@test.local', 'RmAdminPass1')).status, 200);

  const r = await admin.patch('/api/passApplications/APP1', { employeeIds: ['E1'], employeeStatuses: { E1: 'issued' } });
  assert.equal(r.status, 200, JSON.stringify(r.body));

  await srv.stop();
  const check = await openDb(dbPath);
  passes = Object.fromEntries(check.rows(`SELECT id, status, deletedAt FROM passes`).map(p => [p.id, p]));
  srv = await startServer({ dbPath });
  admin = client(srv.base);
  assert.equal((await admin.login('rmadmin@test.local', 'RmAdminPass1')).status, 200);
});
after(async () => { await srv?.stop(); });

test("the removed person's pass on the application is cancelled and hidden; the other is untouched", () => {
  assert.equal(passes.P2.status, 'cancelled');
  assert.ok(passes.P2.deletedAt);
  assert.equal(passes.P1.status, 'issued');
  assert.equal(passes.P1.deletedAt, null);
});

test('a supplementary pass hanging off that main pass is cancelled too', () => {
  assert.equal(passes.S2.status, 'cancelled');
});

test('the workspace shows only the people still on it (no leftover row)', async () => {
  const r = await admin.post('/api/scope', { applicationIds: ['APP1'] });
  const app = r.body.applications.find(a => a.id === 'APP1');
  assert.deepEqual(app.employeeIds, ['E1']);
  assert.deepEqual(r.body.passes.filter(p => (p.requestId || p.applicationId) === 'APP1').map(p => p.id), ['P1']);
});

test('people holding a live pass on an application are returned with it, for their names', async () => {
  await srv.stop();
  const db = await openDb(dbPath);
  // A legacy pass on the application for someone not in its people list
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, type, status, organizationId, createdAt) VALUES
    ('P9', 'APP1', 'E2', 'L1', 'main', 'active', 'org-habari', '2026-10-04')`);
  db.save();
  srv = await startServer({ dbPath });
  admin = client(srv.base);
  assert.equal((await admin.login('rmadmin@test.local', 'RmAdminPass1')).status, 200);
  const r = await admin.post('/api/scope', { applicationIds: ['APP1'] });
  assert.ok(r.body.employees.some(e => e.id === 'E2' && e.name === 'Remove Me'));
});
