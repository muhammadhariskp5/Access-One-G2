// A pass expires by its expiry date - worked out when read, never written by a job or by hand.
// Decisions (cancelled, revoked, replaced) end a pass early. A supplementary pass is a child of a
// main pass: it can't be collected without a valid main pass in the category, and collecting it
// never touches the main pass.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plus = (n) => { const x = new Date(`${today}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const login = async () => {
  admin = client(srv.base);
  assert.equal((await admin.login('dxadmin@test.local', 'DxAdminPass1')).status, 200);
};
const stored = async () => {
  await srv.stop();
  const db = await openDb(dbPath);
  const rows = Object.fromEntries(db.rows(`SELECT id, status, parentPassId, remarks FROM passes`).map(p => [p.id, p]));
  srv = await startServer({ dbPath });
  await login();
  return rows;
};

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO categories (id, name, organizationId) VALUES ('C1', 'Industrial', '${H}')`);
  db.run(`INSERT INTO locations (id, name, code, categoryId, organizationId) VALUES ('L1', 'Ras Gate', 'RG', 'C1', '${H}')`);
  db.run(`INSERT INTO employees (id, name, employeeId, organizationId) VALUES
    ('K', 'Karna Test', 'K-1', '${H}'), ('N', 'No Main', 'N-1', '${H}'), ('P', 'Past Date', 'P-1', '${H}'), ('W', 'Wrongly Expired', 'W-1', '${H}')`);
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, type, status, parentPassId, handoverBy, expiryDate, organizationId, createdAt, updatedAt) VALUES
    ('K_MAIN', 'APP_KM', 'K', 'L1', 'main', 'active', NULL, NULL, '${plus(40)}', '${H}', '2026-01-01', '2026-01-01'),
    ('P_MAIN', NULL, 'P', 'L1', 'main', 'active', NULL, NULL, '${plus(-5)}', '${H}', '2026-01-01', '2026-01-01'),
    ('W_MAIN', 'APP_W', 'W', 'L1', 'main', 'expired', NULL, NULL, '${plus(40)}', '${H}', '2026-01-01', '2026-01-01'),
    ('W_SUPP', NULL, 'W', 'L1', 'supplementary', 'expired', 'W_MAIN', 'Desk', '${plus(40)}', '${H}', '2026-01-02', '2026-01-02')`);
  db.run(`INSERT INTO passRequests (id, locationId, status, type, employeeIds, employeeStatuses, organizationId, createdAt) VALUES
    ('APP_KM', 'L1', 'completed', 'main', '["K"]', '{"K":"collected"}', '${H}', '2026-01-01'),
    ('APP_KS', 'L1', 'issued', 'supplementary', '["K"]', '{"K":"issued"}', '${H}', '2026-11-01'),
    ('APP_NS', 'L1', 'issued', 'supplementary', '["N"]', '{"N":"issued"}', '${H}', '2026-11-01'),
    ('APP_W', 'L1', 'expired', 'main', '["W"]', '{"W":"expired"}', '${H}', '2026-01-01')`);
  db.run(`UPDATE passRequests SET parentPassId = 'K_MAIN', endDate = '${plus(30)}' WHERE id = 'APP_KS'`);
  db.run(`UPDATE passRequests SET endDate = '${plus(30)}' WHERE id = 'APP_NS'`);
  db.run(`DELETE FROM passRequestEmployees`);
  db.run(`DELETE FROM schemaMigrations WHERE id IN ('2026-11-14-link-table-people', '2026-11-15-restore-wrongly-expired', '2026-11-15-settle-supplementaries')`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'dxadmin@test.local', password: 'DxAdminPass1', displayName: 'Dx Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  await login();
});
after(async () => { await srv?.stop(); });

test('repair: a main pass set to expired before its date, and its supplementary, are valid again', async () => {
  const s = await stored();
  assert.equal(s.W_MAIN.status, 'active');
  assert.equal(s.W_SUPP.status, 'collected');
  assert.match(s.W_MAIN.remarks, /Restored/);
  const db = await openDb(dbPath);
  const line = db.rows(`SELECT status FROM passRequestEmployees WHERE requestId = 'APP_W' AND employeeId = 'W'`)[0];
  assert.equal(line.status, 'collected');
});

test('collecting a supplementary leaves the person\'s main pass alone (Karna)', async () => {
  const r = await admin.patch('/api/passApplications/APP_KS/bulk-status', { employeeIds: ['K'], status: 'collected', handoverBy: 'Desk' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const s = await stored();
  assert.equal(s.K_MAIN.status, 'active');
});

test('a supplementary cannot be collected without a valid main pass in the category', async () => {
  const r = await admin.patch('/api/passApplications/APP_NS/bulk-status', { employeeIds: ['N'], status: 'collected' });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /No Main has no valid main pass in the Industrial category/);
  const direct = await admin.post('/api/passes', { employeeId: 'N', locationId: 'L1', type: 'supplementary', status: 'active', expiryDate: plus(30) });
  assert.equal(direct.status, 409);
});

test('a pass past its date reads as expired, but nothing is written to it', async () => {
  const r = await admin.get('/api/passes?page=1&status=expired&q=past date');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map(p => [p.id, p.status]), [['P_MAIN', 'expired']]);
  const s = await stored();
  assert.equal(s.P_MAIN.status, 'active');
});

test('Expired cannot be chosen by hand; to end early use Cancelled or Revoked', async () => {
  const one = await admin.patch('/api/passes/K_MAIN/status', { status: 'expired' });
  assert.equal(one.status, 400);
  assert.match(one.body.error, /expires on its expiry date/);
  const bulk = await admin.patch('/api/passes/bulk-status', { passIds: ['K_MAIN'], status: 'expired' });
  assert.equal(bulk.status, 400);
});

test('the edit form re-sending "expired" for a pass past its date is no change; correcting the date makes it valid', async () => {
  const same = await admin.patch('/api/passes/P_MAIN', { status: 'expired', remarks: 'note' });
  assert.equal(same.status, 200, JSON.stringify(same.body));
  let s = await stored();
  assert.equal(s.P_MAIN.status, 'active');
  const fixed = await admin.patch('/api/passes/P_MAIN', { status: 'expired', expiryDate: plus(60) });
  assert.equal(fixed.status, 200, JSON.stringify(fixed.body));
  const r = await admin.get('/api/passes?page=1&status=active&q=past date');
  assert.deepEqual(r.body.items.map(p => [p.id, p.status]), [['P_MAIN', 'active']]);
});

test('a supplementary application cannot be created (or someone added) without a valid main pass', async () => {
  const r = await admin.post('/api/passApplications', { employeeIds: ['N'], locationId: 'L1', type: 'supplementary', endDate: plus(20) });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.match(r.body.error, /No Main has no valid main pass in the Industrial category.*applied for/);
  const ok = await admin.post('/api/passApplications', { employeeIds: ['K'], locationId: 'L1', type: 'supplementary', endDate: plus(20) });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const add = await admin.patch(`/api/passApplications/${ok.body.id}`, { employeeIds: ['K', 'N'] });
  assert.equal(add.status, 409, JSON.stringify(add.body));
});
