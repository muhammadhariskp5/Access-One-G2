// Employee identifier lookup (form duplicate hints) and per-employee usage (delete warning).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin;
const lookup = async (values, excludeId) => (await admin.post('/api/employees/lookup-ids', { values, excludeId })).body;

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO locations (id, name, code, organizationId) VALUES ('L1', 'Alpha Gate', 'AG', '${H}')`);
  db.run(`INSERT INTO employees (id, name, employeeId, qidVisaNumber, qatarId, passportNumber, organizationId) VALUES
    ('E1', 'Zara Young', 'Z-1', 'QV111', NULL, 'PP-1', '${H}'),
    ('E2', 'Adam Bell', 'A-2', NULL, 'Q222', NULL, '${H}'),
    ('E3', 'Gone Person', 'G-3', 'QV333', NULL, NULL, '${H}'),
    ('E4', 'Other Org', 'X-4', 'QV444', NULL, NULL, 'org-elsewhere')`);
  db.run(`UPDATE employees SET deletedAt = '2026-01-01' WHERE id = 'E3'`);
  db.run(`INSERT INTO passes (id, employeeId, locationId, status, organizationId) VALUES
    ('P1', 'E1', 'L1', 'active', '${H}'), ('P2', 'E1', 'L1', 'expired', '${H}')`);
  db.run(`INSERT INTO passRequests (id, locationId, status, employeeIds, organizationId, createdAt) VALUES
    ('APP1', 'L1', 'pending', '["E1"]', '${H}', '2026-10-01'), ('APP2', 'L1', 'completed', '["E1"]', '${H}', '2026-10-01')`);
  db.run(`DELETE FROM passRequestEmployees`);
  db.run(`DELETE FROM schemaMigrations WHERE id = '2026-11-13-pass-list-expiry-and-indexes'`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'lookadmin@test.local', password: 'LookAdminPass1', displayName: 'Look Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  admin = client(srv.base);
  assert.equal((await admin.login('lookadmin@test.local', 'LookAdminPass1')).status, 200);
});
after(async () => { await srv?.stop(); });

test('finds codes (any case), QID/visa numbers and passports of live employees in this org', async () => {
  const r = await lookup(['z-1', 'Q222', 'QV111', 'PP-1', 'NEW-9']);
  assert.deepEqual(r.employeeId, ['z-1']);
  assert.deepEqual(r.document.sort(), ['Q222', 'QV111']);
  assert.deepEqual(r.passport, ['PP-1']);
});

test('ignores deleted employees, other organizations, and the employee being edited', async () => {
  const r = await lookup(['G-3', 'QV333', 'X-4', 'QV444']);
  assert.deepEqual(r, { employeeId: [], document: [], passport: [] });
  const self = await lookup(['Z-1', 'QV111'], 'E1');
  assert.deepEqual(self, { employeeId: [], document: [], passport: [] });
});

test('usage counts only open passes and in-progress applications', async () => {
  const r = await admin.get('/api/employees/E1/usage');
  assert.deepEqual(r.body, { activePasses: 1, activeApplications: 1 });
});
