// One valid main pass per person per category: a second one is refused (before anything is written)
// until the first is cancelled or expires; renewal within 45 days of expiry is the exception and
// retires the old pass when collected. Existing duplicates are only reported.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin, initial;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plus = (n) => { const x = new Date(`${today}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const restart = async () => {
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
  db.run(`INSERT INTO employees (id, name, firstName, lastName, employeeId, qidVisaNumber, organizationId) VALUES
    ('E1', 'Dup Holder', 'Dup', 'Holder', 'D-1', 'QV-D1', '${H}'),
    ('E2', 'Renewing Person', 'Renewing', 'Person', 'R-2', 'QV-R2', '${H}'),
    ('E3', 'Holds Main', 'Holds', 'Main', 'H-3', 'QV-H3', '${H}')`);
  db.run(`INSERT INTO passes (id, employeeId, locationId, type, status, passNumber, parentPassId, expiryDate, organizationId, createdAt) VALUES
    ('M_SHORT', 'E1', 'L1', 'main', 'active', 'PN-S', NULL, '${plus(80)}', '${H}', '2026-01-01'),
    ('M_LONG',  'E1', 'L2', 'main', 'collected', 'PN-L', NULL, '${plus(400)}', '${H}', '2026-02-01'),
    ('E2_OLD', 'E2', 'L1', 'main', 'active', 'PN-O', NULL, '${plus(30)}', '${H}', '2026-01-01'),
    ('E2_NEW', 'E2', 'L2', 'main', 'issued', 'PN-N', NULL, '${plus(395)}', '${H}', '2026-11-10'),
    ('E3_MAIN', 'E3', 'L1', 'main', 'active', 'PN-3', NULL, '${plus(200)}', '${H}', '2026-01-01'),
    ('E3_NEW', 'E3', 'L2', 'main', 'issued', 'PN-3B', NULL, '${plus(500)}', '${H}', '2026-11-10')`);
  db.run(`INSERT INTO passRequests (id, locationId, status, type, employeeIds, employeeStatuses, organizationId, createdAt) VALUES
    ('APP_R', 'L2', 'issued', 'main', '["E2"]', '{"E2":"issued"}', '${H}', '2026-11-10'),
    ('APP_X', 'L2', 'issued', 'main', '["E3"]', '{"E3":"issued"}', '${H}', '2026-11-10')`);
  db.run(`UPDATE passes SET requestId = 'APP_R' WHERE id = 'E2_NEW'`);
  db.run(`UPDATE passes SET requestId = 'APP_X' WHERE id = 'E3_NEW'`);
  db.run(`DELETE FROM passRequestEmployees`);
  db.run(`DELETE FROM schemaMigrations WHERE id IN ('2026-11-14-link-table-people', '2026-11-14-one-main-pass-per-category')`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'mpadmin@test.local', password: 'MpAdminPass1', displayName: 'Mp Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  initial = await restart();
});
after(async () => { await srv?.stop(); });

test('existing duplicates are only reported, never replaced automatically', () => {
  assert.equal(initial.M_SHORT.status, 'active');
  assert.equal(initial.M_LONG.status, 'collected');
});

test('a second main application in the category is refused while one is valid', async () => {
  const r = await admin.post('/api/passApplications', { employeeIds: ['E3'], locationId: 'L2', type: 'main', endDate: plus(300) });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /Holds Main already holds a valid main pass in this category \(PN-3 at Gate One/);
  assert.match(r.body.error, /cancel that pass first/);
});

test('a supplementary in the same category is still allowed', async () => {
  const r = await admin.post('/api/passApplications', { employeeIds: ['E3'], locationId: 'L2', type: 'supplementary', endDate: plus(100) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('a direct main pass in another category is fine; in the same category it is refused', async () => {
  const other = await admin.post('/api/passes', { employeeId: 'E3', locationId: 'L3', type: 'main', status: 'active', expiryDate: plus(100) });
  assert.equal(other.status, 200, JSON.stringify(other.body));
  const same = await admin.post('/api/passes', { employeeId: 'E3', locationId: 'L2', type: 'main', status: 'active', expiryDate: plus(100) });
  assert.equal(same.status, 409);
});

test('collecting a second main pass is refused and nothing changes', async () => {
  const r = await admin.patch('/api/passApplications/APP_X/status', { status: 'collected' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  const s = await restart();
  assert.equal(s.E3_NEW.status, 'issued');
  assert.equal(s.E3_MAIN.status, 'active');
});

test('a renewal (current pass ends within 45 days) is allowed and retires the old pass when collected', async () => {
  const r = await admin.patch('/api/passApplications/APP_R/status', { status: 'collected' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = await restart();
  assert.equal(s.E2_NEW.status, 'active');
  assert.equal(s.E2_OLD.status, 'replaced');
});
