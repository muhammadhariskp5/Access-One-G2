// A supplementary pass is valid only while its person holds a valid main pass in that category:
// re-linked to another valid main pass there if there is one, otherwise ended - whatever ended the
// main pass, and for supplementaries with no main pass linked at all.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin, s0;
const states = async () => {
  await srv.stop();
  const db = await openDb(dbPath);
  const rows = Object.fromEntries(db.rows(`SELECT id, status, parentPassId FROM passes`).map(p => [p.id, p]));
  srv = await startServer({ dbPath });
  admin = client(srv.base);
  assert.equal((await admin.login('spadmin@test.local', 'SpAdminPass1')).status, 200);
  return rows;
};

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO categories (id, name, organizationId) VALUES ('C1', 'Ports', '${H}')`);
  db.run(`INSERT INTO locations (id, name, code, categoryId, organizationId) VALUES ('L1', 'Gate One', 'G1', 'C1', '${H}'), ('L2', 'Gate Two', 'G2', 'C1', '${H}')`);
  db.run(`INSERT INTO employees (id, name, employeeId, organizationId) VALUES
    ('E1', 'Main Cancelled', 'E-1', '${H}'), ('E2', 'Main Replaced', 'E-2', '${H}'), ('E3', 'No Link Has Main', 'E-3', '${H}'),
    ('E4', 'No Link No Main', 'E-4', '${H}'), ('E5', 'All Good', 'E-5', '${H}')`);
  db.run(`INSERT INTO passes (id, employeeId, locationId, type, status, parentPassId, expiryDate, organizationId, createdAt) VALUES
    ('M1', 'E1', 'L1', 'main', 'cancelled', NULL, '2099-01-01', '${H}', '2026-01-01'),
    ('S1', 'E1', 'L2', 'supplementary', 'active', 'M1', '2099-01-01', '${H}', '2026-01-02'),
    ('M2A', 'E2', 'L1', 'main', 'replaced', NULL, '2099-01-01', '${H}', '2026-01-01'),
    ('M2B', 'E2', 'L1', 'main', 'active', NULL, '2099-06-01', '${H}', '2026-02-01'),
    ('S2', 'E2', 'L2', 'supplementary', 'active', 'M2A', '2099-01-01', '${H}', '2026-01-02'),
    ('M3', 'E3', 'L2', 'main', 'collected', NULL, '2099-01-01', '${H}', '2026-01-01'),
    ('S3', 'E3', 'L1', 'supplementary', 'active', NULL, '2099-01-01', '${H}', '2026-01-02'),
    ('S4', 'E4', 'L1', 'supplementary', 'active', NULL, '2099-01-01', '${H}', '2026-01-02'),
    ('M5', 'E5', 'L1', 'main', 'active', NULL, '2099-01-01', '${H}', '2026-01-01'),
    ('S5', 'E5', 'L2', 'supplementary', 'active', 'M5', '2099-01-01', '${H}', '2026-01-02')`);
  db.run(`DELETE FROM schemaMigrations WHERE id = '2026-11-15-settle-supplementaries'`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'spadmin@test.local', password: 'SpAdminPass1', displayName: 'Sp Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  s0 = await states();
});
after(async () => { await srv?.stop(); });

test('main pass cancelled and no other valid main: the supplementary ends', () => {
  assert.equal(s0.S1.status, 'cancelled');
});

test('main pass replaced but another valid main exists: the supplementary moves to it', () => {
  assert.equal(s0.S2.status, 'active');
  assert.equal(s0.S2.parentPassId, 'M2B');
});

test('a supplementary with no main pass linked: linked if one is valid, ended if not', () => {
  assert.equal(s0.S3.status, 'active');
  assert.equal(s0.S3.parentPassId, 'M3');
  assert.equal(s0.S4.status, 'cancelled');
});

test('a valid pair is left alone', () => {
  assert.equal(s0.S5.status, 'active');
  assert.equal(s0.S5.parentPassId, 'M5');
});

test('ending a main pass through Pass Status (rejected) ends its supplementary at once', async () => {
  const r = await admin.patch('/api/passes/bulk-status', { passIds: ['M5'], status: 'rejected', remarks: 'test' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = await states();
  assert.equal(s.M5.status, 'rejected');
  assert.ok(['rejected', 'cancelled'].includes(s.S5.status), s.S5.status);   // ended with its main pass
});
