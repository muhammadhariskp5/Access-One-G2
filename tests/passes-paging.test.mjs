// Server-side pass list (Pass Status Management): live passes + people on applications without a
// pass yet, with names joined; search, status groups, history hiding, dates, sort, paging, scope.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin;
const list = async (qs) => (await admin.get(`/api/passes?${qs}`)).body;
const ids = (r) => r.items.map(p => p.id);

before(async () => {
  // 1st start creates the schema; seed directly, re-arm the backfill migration, start again.
  srv = await startServer({ dbPath });
  await srv.stop();

  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO locations (id, name, code, organizationId) VALUES ('L1', 'Alpha Gate', 'AG', '${H}'), ('L2', 'Zulu Yard', 'ZY', '${H}')`);
  db.run(`INSERT INTO employees (id, name, employeeId, qatarId, organizationId) VALUES
    ('E1', 'Zara Young', 'Z-1', 'Q111', '${H}'), ('E2', 'Adam Bell', 'A-2', NULL, '${H}'),
    ('E3', 'Mona Lee', 'M-3', NULL, '${H}'), ('E4', 'Other Org', 'O-4', NULL, 'org-elsewhere')`);
  // APP1: E1 has a pass; E2 approved with an own expiry; E3 still processing (app status)
  db.run(`INSERT INTO passRequests (id, locationId, status, employeeIds, employeeStatuses, individualExpiries, endDate, accessCodes, organizationId, createdAt, updatedAt)
    VALUES ('APP1', 'L1', 'processing', '["E1","E2","E3"]', '{"E1":"collected","E2":"approved"}', '{"E2":"2027-03-31"}', '2027-12-31', '["A9"]', '${H}', '2026-10-01T08:00:00.000Z', '2026-10-02T08:00:00.000Z')`);
  // APP2: closed; E3 has an expired pass, E2 a replaced one
  db.run(`INSERT INTO passRequests (id, locationId, status, employeeIds, employeeStatuses, organizationId, createdAt, updatedAt)
    VALUES ('APP2', 'L2', 'expired', '["E3"]', '{"E3":"expired"}', '${H}', '2025-01-01T08:00:00.000Z', '2025-01-01T08:00:00.000Z')`);
  // Another organization's application
  db.run(`INSERT INTO passRequests (id, locationId, status, employeeIds, employeeStatuses, organizationId, createdAt, updatedAt)
    VALUES ('APPX', 'L1', 'pending', '["E4"]', '{}', 'org-elsewhere', '2026-10-01T08:00:00.000Z', '2026-10-01T08:00:00.000Z')`);
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, type, status, passNumber, startDate, expiryDate, accessCodes, organizationId, createdAt, updatedAt) VALUES
    ('P1', 'APP1', 'E1', 'L1', 'main', 'active', 'PN-100', '2026-10-05', '2027-06-30', '["A1"]', '${H}', '2026-10-05T08:00:00.000Z', '2026-10-05T08:00:00.000Z'),
    ('P2', 'APP2', 'E3', 'L2', 'main', 'expired', 'PN-050', '2025-01-05', '05/06/2025', '[]', '${H}', '2025-01-05T08:00:00.000Z', '2025-01-05T08:00:00.000Z'),
    ('P3', 'APP2', 'E2', 'L2', 'main', 'replaced', 'PN-040', '2025-01-05', '2025-12-31', '[]', '${H}', '2025-01-05T08:00:00.000Z', '2025-01-05T08:00:00.000Z')`);
  db.run(`DELETE FROM passRequestEmployees`);
  db.run(`DELETE FROM schemaMigrations WHERE id = '2026-11-13-pass-list-expiry-and-indexes'`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'passadmin@test.local', password: 'PassAdminPass1', displayName: 'Pass Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  admin = client(srv.base);
  assert.equal((await admin.login('passadmin@test.local', 'PassAdminPass1')).status, 200);
});
after(async () => { await srv?.stop(); });

test('without paging parameters the plain pass array is still returned', async () => {
  const r = await admin.get('/api/passes');
  assert.ok(Array.isArray(r.body));
});

test('default list: live passes plus people still waiting, history hidden, own org only', async () => {
  const r = await list('page=1&sort=employee');
  assert.equal(r.total, 3);
  assert.deepEqual(r.items.map(p => p.employeeName), ['Adam Bell', 'Mona Lee', 'Zara Young']);
  const e2 = r.items.find(p => p.employeeId === 'E2');
  assert.equal(e2.id, 'virtual-APP1-E2');
  assert.equal(e2.isVirtual, true);
  assert.equal(e2.applicationId, 'APP1');
  assert.equal(e2.status, 'approved');
  assert.equal(e2.expiryDate, '2027-03-31');          // own expiry from the application
  assert.deepEqual(e2.accessCodes, ['A9']);
  assert.equal(e2.locationName, 'Alpha Gate');
  assert.equal(e2.locationCode, 'AG');
  const e3 = r.items.find(p => p.employeeId === 'E3');
  assert.equal(e3.status, 'processing');
  assert.equal(e3.expiryDate, '2027-12-31');          // falls back to the application end date
  const e1 = r.items.find(p => p.employeeId === 'E1');
  assert.equal(e1.id, 'P1');
  assert.equal(e1.employeeCode, 'Z-1');
  assert.deepEqual(e1.accessCodes, ['A1']);
});

test('status groups: active, expired, replaced', async () => {
  assert.deepEqual(ids(await list('page=1&status=active')), ['P1']);
  assert.deepEqual(ids(await list('page=1&status=expired')), ['P2']);
  assert.deepEqual(ids(await list('page=1&status=replaced')), ['P3']);
  assert.deepEqual(ids(await list('page=1&status=approved')), ['virtual-APP1-E2']);
});

test('searching also finds history; matches name, QID, pass number and location', async () => {
  assert.deepEqual(ids(await list('page=1&q=mona&sort=passInfo')).sort(), ['P2', 'virtual-APP1-E3']);
  assert.deepEqual(ids(await list('page=1&q=q111')), ['P1']);
  assert.deepEqual(ids(await list('page=1&q=pn-04')), ['P3']);
  assert.equal((await list('page=1&q=zulu')).total, 2);
  assert.equal((await list('page=1&q=50%25')).total, 0);   // % is literal
});

test('date range uses validity (handles DD/MM/YYYY dates)', async () => {
  // valid on/after 2025-06-01: P2 ended 2025-06-05 -> still in range
  assert.deepEqual(ids(await list('page=1&status=expired&from=2025-06-01')), ['P2']);
  assert.deepEqual(ids(await list('page=1&status=expired&from=2025-06-06')), []);
  // within 2027-04-30: only E2 (ends 2027-03-31)
  assert.deepEqual(ids(await list('page=1&to=2027-04-30')), ['virtual-APP1-E2']);
});

test('sort by validity descending, paging adds up', async () => {
  const all = ids(await list('page=1&sort=validity&order=desc'));
  assert.deepEqual(all, ['virtual-APP1-E3', 'P1', 'virtual-APP1-E2']);
  const p2 = await list('page=2&pageSize=2&sort=validity&order=desc');
  assert.deepEqual(ids(p2), ['virtual-APP1-E2']);
  assert.equal(p2.total, 3);
});

test('all=1 returns every matching row; bad sort and huge page sizes are clamped', async () => {
  assert.equal((await list('all=1&q=e')).items.length, (await list('all=1&q=e')).total);
  const r = await admin.get('/api/passes?page=1&pageSize=99999&sort=name;DROP%20TABLE%20passes');
  assert.equal(r.status, 200);
  assert.equal(r.body.pageSize, 200);
});

