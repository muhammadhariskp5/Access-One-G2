// Passes / applications that name a person by staff code or QID are re-linked to the person's ID,
// so the server-side screens (Access Matrix, workspace) find them; the admin explain view shows why.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin, stored;

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO locations (id, name, code, organizationId) VALUES ('L1', 'Alpha Gate', 'AG', '${H}')`);
  db.run(`INSERT INTO employees (id, name, employeeId, qatarId, organizationId) VALUES
    ('E1', 'Ramshad Test Nazar', 'C-9', 'Q9', '${H}'), ('E2', 'Someone Else', 'C-10', NULL, '${H}')`);
  db.run(`INSERT INTO passes (id, employeeId, locationId, type, status, expiryDate, organizationId, createdAt) VALUES
    ('P1', ' c-9', 'L1', 'main', 'active', '2099-01-01', '${H}', '2026-01-01'),
    ('P2', 'Q9', 'L1', 'supplementary', 'active', '2099-01-01', '${H}', '2026-01-01'),
    ('P3', 'NOBODY', 'L1', 'main', 'active', '2099-01-01', '${H}', '2026-01-01')`);
  db.run(`INSERT INTO passRequests (id, locationId, status, type, employeeIds, employeeStatuses, organizationId, createdAt) VALUES
    ('APP1', 'L1', 'processing', 'main', '["C-9","E2"]', '{"C-9":"accepted"}', '${H}', '2026-10-01')`);
  db.run(`DELETE FROM passRequestEmployees`);
  db.run(`DELETE FROM schemaMigrations WHERE id IN ('2026-11-14-link-table-people', '2026-11-14-relink-employee-references')`);
  db.save();

  srv = await startServer({ dbPath });
  await srv.stop();
  const check = await openDb(dbPath);
  stored = Object.fromEntries(check.rows(`SELECT id, employeeId FROM passes`).map(p => [p.id, p.employeeId]));
  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'rladmin@test.local', password: 'RlAdminPass1', displayName: 'Rl Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  admin = client(srv.base);
  assert.equal((await admin.login('rladmin@test.local', 'RlAdminPass1')).status, 200);
});
after(async () => { await srv?.stop(); });

test('passes naming a person by code (any case / spacing) or QID now point at their ID', () => {
  assert.equal(stored.P1, 'E1');
  assert.equal(stored.P2, 'E1');
  assert.equal(stored.P3, 'NOBODY');             // matches nobody: left alone
});

test('the person now appears on the Access Matrix with both passes', async () => {
  const r = await admin.get('/api/matrix?page=1&status=active&expiredDays=30&q=ramshad');
  assert.deepEqual(r.body.items.map(e => e.id), ['E1']);
  assert.deepEqual(r.body.items[0].passes.map(p => p.id).sort(), ['P1', 'P2']);
});

test('an application listing the person by code gets them back, with their status', async () => {
  const s = await admin.post('/api/scope', { applicationIds: ['APP1'] });
  const app = s.body.applications.find(a => a.id === 'APP1');
  assert.deepEqual(app.employeeIds.sort(), ['E1', 'E2']);
  assert.equal(app.employeeStatuses.E1, 'accepted');
});

test('explain view (admin) shows each pass and why it counts', async () => {
  const r = await admin.get('/api/matrix/explain?q=ramshad');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const res0 = r.body.results[0];
  assert.equal(res0.employee.id, 'E1');
  assert.ok(res0.passes.every(p => p.linkedBy === 'id' && p.valid));
});
