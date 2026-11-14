// Dashboard summary (/api/dashboard): counts, short lists and groupings computed by the server.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin, d;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plus = (n) => { const x = new Date(`${today}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const dmy = (ymd) => `${ymd.slice(8, 10)}/${ymd.slice(5, 7)}/${ymd.slice(0, 4)}`;

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO categories (id, name, organizationId) VALUES ('C1', 'Ports', '${H}')`);
  db.run(`INSERT INTO locations (id, name, code, categoryId, organizationId) VALUES ('L1', 'Alpha Gate', 'AG', 'C1', '${H}'), ('L2', 'Zulu Yard', 'ZY', NULL, '${H}')`);
  db.run(`INSERT INTO employees (id, name, employeeId, organizationId) VALUES
    ('E1', 'Zara Young', 'Z-1', '${H}'), ('E2', 'Adam Bell', 'A-2', '${H}'), ('E3', 'Gone', 'G-3', '${H}'), ('E4', 'Elsewhere', 'X-4', 'org-elsewhere')`);
  db.run(`UPDATE employees SET deletedAt = '2026-01-01' WHERE id = 'E3'`);
  db.run(`INSERT INTO passes (id, employeeId, locationId, status, passNumber, expiryDate, organizationId, createdAt) VALUES
    ('P1', 'E1', 'L1', 'active', 'PN-1', '${plus(1)}', '${H}', '2026-01-01'),
    ('P2', 'E2', 'L1', 'collected', 'PN-2', '${dmy(plus(10))}', '${H}', '2026-01-01'),
    ('P3', 'E2', 'L2', 'active', 'PN-3', '${plus(90)}', '${H}', '2026-01-01'),
    ('P4', 'E1', 'L2', 'expired', 'PN-4', '${plus(-1)}', '${H}', '2026-01-01'),
    ('P5', 'E4', 'L1', 'active', 'PN-5', '${plus(1)}', 'org-elsewhere', '2026-01-01')`);
  db.run(`INSERT INTO passRequests (id, locationId, status, type, employeeIds, organizationId, createdAt) VALUES
    ('APP1', 'L1', 'pending', 'main', '["E1","E2"]', '${H}', '2026-10-03T00:00:00Z'),
    ('APP2', 'L2', 'completed', 'main', '["E1"]', '${H}', '2026-10-02T00:00:00Z'),
    ('APP3', 'L2', 'expired', 'supplementary', '["E2"]', '${H}', '2026-10-01T00:00:00Z'),
    ('APP4', 'L1', 'issued', 'main', '["E2"]', '${H}', '2026-09-01T00:00:00Z')`);
  // APP4 still says "issued" but its only person has collected: it is completed, not in progress
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, status, passNumber, expiryDate, organizationId, createdAt) VALUES
    ('P9', 'APP4', 'E2', 'L1', 'collected', 'PN-9', '${plus(200)}', '${H}', '2026-09-02')`);
  db.run(`DELETE FROM passRequestEmployees`);
  db.run(`DELETE FROM schemaMigrations WHERE id = '2026-11-13-pass-list-expiry-and-indexes'`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'dashadmin@test.local', password: 'DashAdminPass1', displayName: 'Dash Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  admin = client(srv.base);
  assert.equal((await admin.login('dashadmin@test.local', 'DashAdminPass1')).status, 200);
  const r = await admin.get('/api/dashboard');
  assert.equal(r.status, 200, JSON.stringify(r.body));
  d = r.body;
});
after(async () => { await srv?.stop(); });

test('counts: live employees, active passes, in-progress applications, own org only', () => {
  assert.equal(d.employeeCount, 2);
  assert.equal(d.totalPassCount, 5);
  assert.equal(d.activePassCount, 4);
  assert.equal(d.activeApplicationCount, 1);
  assert.deepEqual(d.activeApplications.map(a => a.id), ['APP1']);
  assert.equal(d.activeApplications[0].employeeCount, 2);
  assert.equal(d.activeApplications[0].locationName, 'Alpha Gate');
});

test('expiring: next 48h listed with names, next 30 days grouped (any stored date format)', () => {
  assert.equal(d.expiring48hCount, 1);
  assert.deepEqual(d.expiring48h.map(p => [p.id, p.employeeName, p.locationName]), [['P1', 'Zara Young', 'Alpha Gate']]);
  assert.equal(d.expiringSoonCount, 2);
  assert.deepEqual(d.expiringByLocation, [['Alpha Gate', 2]]);
  assert.deepEqual(d.expiringByCategory, [['Ports', 2]]);
  assert.deepEqual(d.activeByLocation, { L1: 3, L2: 1 });
});

test('recent activity: five newest submissions, searchable', async () => {
  assert.deepEqual(d.recentApplications.map(a => a.id), ['APP1', 'APP2', 'APP3', 'APP4']);
  const r = await admin.get('/api/dashboard?q=zulu');
  assert.deepEqual(r.body.recentApplications.map(a => a.id), ['APP2', 'APP3']);
});
