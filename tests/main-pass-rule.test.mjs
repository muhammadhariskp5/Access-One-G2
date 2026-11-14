// One valid main pass per person per category: existing duplicates are resolved (longest-valid kept,
// supplementaries moved to it), and activating an application cannot create a second one.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin, after1;
const passStates = async () => {
  await srv.stop();
  const db = await openDb(dbPath);
  const rows = Object.fromEntries(db.rows(`SELECT id, status, parentPassId FROM passes`).map(p => [p.id, p]));
  srv = await startServer({ dbPath });
  admin = client(srv.base);
  assert.equal((await admin.login('mpadmin@test.local', 'MpAdminPass1')).status, 200);
  return rows;
};

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO categories (id, name, organizationId) VALUES ('C1', 'Ports', '${H}'), ('C2', 'Plants', '${H}')`);
  db.run(`INSERT INTO locations (id, name, code, categoryId, organizationId) VALUES
    ('L1', 'Gate One', 'G1', 'C1', '${H}'), ('L2', 'Gate Two', 'G2', 'C1', '${H}'), ('L3', 'Plant', 'P1', 'C2', '${H}')`);
  db.run(`INSERT INTO employees (id, name, employeeId, organizationId) VALUES ('E1', 'Dup Holder', 'D-1', '${H}'), ('E2', 'Renewing', 'R-2', '${H}')`);
  db.run(`INSERT INTO passes (id, employeeId, locationId, type, status, parentPassId, expiryDate, organizationId, createdAt) VALUES
    ('M_SHORT', 'E1', 'L1', 'main', 'active', NULL, '2027-01-31', '${H}', '2026-01-01'),
    ('M_LONG',  'E1', 'L2', 'main', 'collected', NULL, '2027-12-31', '${H}', '2026-02-01'),
    ('M_OTHER', 'E1', 'L3', 'main', 'active', NULL, '2027-06-30', '${H}', '2026-01-01'),
    ('S_ON_SHORT', 'E1', 'L1', 'supplementary', 'active', 'M_SHORT', '2027-01-31', '${H}', '2026-01-05'),
    ('E2_OLD', 'E2', 'L1', 'main', 'active', NULL, '2026-12-29', '${H}', '2026-01-01'),
    ('E2_NEW', 'E2', 'L2', 'main', 'issued', NULL, '2027-12-29', '${H}', '2026-11-10')`);
  db.run(`INSERT INTO passRequests (id, locationId, status, type, employeeIds, employeeStatuses, organizationId, createdAt) VALUES
    ('APP_R', 'L2', 'issued', 'main', '["E2"]', '{"E2":"issued"}', '${H}', '2026-11-10')`);
  db.run(`UPDATE passes SET requestId = 'APP_R' WHERE id = 'E2_NEW'`);
  db.run(`DELETE FROM passRequestEmployees`);
  db.run(`DELETE FROM schemaMigrations WHERE id IN ('2026-11-14-link-table-people', '2026-11-14-one-main-pass-per-category')`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'mpadmin@test.local', password: 'MpAdminPass1', displayName: 'Mp Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  after1 = await passStates();
});
after(async () => { await srv?.stop(); });

test('existing duplicates: the one valid longest is kept, the other replaced', () => {
  assert.equal(after1.M_LONG.status, 'collected');
  assert.equal(after1.M_SHORT.status, 'replaced');
  assert.equal(after1.M_OTHER.status, 'active');          // other category: untouched
});

test("a supplementary on the replaced pass moves to the kept one (stays valid)", () => {
  assert.equal(after1.S_ON_SHORT.status, 'active');
  assert.equal(after1.S_ON_SHORT.parentPassId, 'M_LONG');
});

test('an issued renewal does not cut off the current pass until it is collected', () => {
  assert.equal(after1.E2_OLD.status, 'active');
  assert.equal(after1.E2_NEW.status, 'issued');
});

test('collecting the renewal leaves exactly one valid main pass', async () => {
  const r = await admin.patch('/api/passApplications/APP_R/status', { status: 'collected' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = await passStates();
  assert.equal(s.E2_NEW.status, 'active');
  assert.equal(s.E2_OLD.status, 'replaced');
});
