// Server-side application list (Applications screen): status rolled up from each person's line
// and pass, Active / History tabs with counts, search, stage pills, type, dates, sort, paging, scope.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin;
const list = async (qs) => (await admin.get(`/api/passApplications?${qs}`)).body;
const ids = (r) => r.items.map(a => a.id);

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();

  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO locations (id, name, code, organizationId) VALUES ('L1', 'Alpha Gate', 'AG', '${H}'), ('L2', 'Zulu Yard', 'ZY', '${H}')`);
  db.run(`INSERT INTO employees (id, name, employeeId, qatarId, organizationId) VALUES
    ('E1', 'Zara Young', 'Z-1', 'Q111', '${H}'), ('E2', 'Adam Bell', 'A-2', NULL, '${H}'),
    ('E3', 'Mona Lee', 'M-3', NULL, '${H}'), ('E4', 'Other Org', 'O-4', NULL, 'org-elsewhere')`);
  const app = (id, loc, status, type, emps, statuses, endDate, created, org = H) => db.run(
    `INSERT INTO passRequests (id, locationId, status, type, employeeIds, employeeStatuses, endDate, organizationId, createdAt, updatedAt)
     VALUES ('${id}', '${loc}', '${status}', '${type}', '${JSON.stringify(emps)}', '${JSON.stringify(statuses)}', ${endDate ? `'${endDate}'` : 'NULL'}, '${org}', '${created}', '${created}')`);
  // APP1: one collected (pass), one approved, one processing -> partially issued, active
  app('APP1', 'L1', 'processing', 'main', ['E1', 'E2', 'E3'], { E2: 'approved' }, '2027-12-31', '2026-10-05T08:00:00.000Z');
  // APP2: closed as expired -> history
  app('APP2', 'L2', 'expired', 'main', ['E3'], { E3: 'expired' }, '2025-06-30', '2025-01-01T08:00:00.000Z');
  // APP3: still "processing" on paper, but everyone has collected -> completed -> history
  app('APP3', 'L2', 'processing', 'main', ['E2'], {}, '2027-01-31', '2026-09-01T08:00:00.000Z');
  // APP4: everyone cancelled -> cancelled -> history
  app('APP4', 'L1', 'pending', 'main', ['E1'], { E1: 'cancelled' }, '2027-01-31', '2026-08-01T08:00:00.000Z');
  // APP5: supplementary, waiting for review -> active
  app('APP5', 'L2', 'pending', 'supplementary', ['E2'], {}, '2028-05-31', '2026-07-01T08:00:00.000Z');
  app('APPX', 'L1', 'pending', 'main', ['E4'], {}, null, '2026-10-01T08:00:00.000Z', 'org-elsewhere');
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, type, status, passNumber, organizationId, createdAt, updatedAt) VALUES
    ('P1', 'APP1', 'E1', 'L1', 'main', 'active', 'PN-1', '${H}', '2026-10-06T08:00:00.000Z', '2026-10-06T08:00:00.000Z'),
    ('P0', 'APP3', 'E2', 'L2', 'main', 'issued', 'PN-0', '${H}', '2026-09-02T08:00:00.000Z', '2026-09-02T08:00:00.000Z'),
    ('P3', 'APP3', 'E2', 'L2', 'main', 'collected', 'PN-3', '${H}', '2026-09-05T08:00:00.000Z', '2026-09-05T08:00:00.000Z')`);
  // Rebuild the link table from the applications (as the deployed migration does)
  db.run(`DELETE FROM passRequestEmployees`);
  db.run(`DELETE FROM schemaMigrations WHERE id = '2026-11-13-pass-list-expiry-and-indexes'`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'appadmin@test.local', password: 'AppAdminPass1', displayName: 'App Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  admin = client(srv.base);
  assert.equal((await admin.login('appadmin@test.local', 'AppAdminPass1')).status, 200);
});
after(async () => { await srv?.stop(); });

test('without paging parameters the plain application array is still returned', async () => {
  const r = await admin.get('/api/passApplications');
  assert.ok(Array.isArray(r.body));
});

test('active tab: rolled-up status, stage counts, tab counts, own org only', async () => {
  const r = await list('page=1&tab=active');
  assert.deepEqual(ids(r), ['APP1', 'APP5']);
  assert.equal(r.total, 2);
  assert.equal(r.activeCount, 2);
  assert.equal(r.archivedCount, 3);
  const a1 = r.items[0];
  assert.equal(a1.rollupStatus, 'partially_issued');
  assert.deepEqual(a1.stats, { activeCollectedCount: 1, issuedCount: 0, acceptedCount: 1, processingCount: 1, pendingCount: 0, cancelledCount: 0, total: 3 });
  assert.deepEqual(a1.employeeIds, ['E1', 'E2', 'E3']);
  assert.equal(a1.locationName, 'Alpha Gate');
  assert.equal(a1.locationCode, 'AG');
  assert.equal(r.items[1].rollupStatus, 'pending');
});

test('history is listed only on a search, but its count always shows', async () => {
  const r = await list('page=1&tab=archived');
  assert.equal(r.total, 0);
  assert.deepEqual(r.items, []);
  assert.equal(r.archivedCount, 3);
  const found = await list('page=1&tab=archived&q=adam');
  assert.deepEqual(ids(found), ['APP3']);
  assert.equal(found.items[0].rollupStatus, 'completed');   // latest pass (collected) wins
  const cancelled = await list('page=1&tab=archived&q=app4');
  assert.equal(cancelled.items[0].rollupStatus, 'cancelled');
});

test('search: person, QID, application number, location', async () => {
  assert.deepEqual(ids(await list('page=1&tab=active&q=mona')), ['APP1']);
  assert.deepEqual(ids(await list('page=1&tab=active&q=q111')), ['APP1']);
  assert.deepEqual(ids(await list('page=1&tab=active&q=app5')), ['APP5']);
  assert.deepEqual(ids(await list('page=1&tab=active&q=zulu')), ['APP5']);
  assert.deepEqual(ids(await list('page=1&tab=active&q=%25')), []);   // wildcard is literal
});

test('stage pill, type and dates', async () => {
  assert.deepEqual(ids(await list('page=1&tab=active&status=pending')), ['APP5']);
  assert.deepEqual(ids(await list('page=1&tab=active&status=processing')), ['APP1']);
  assert.deepEqual(ids(await list('page=1&tab=active&type=supplementary')), ['APP5']);
  assert.deepEqual(ids(await list('page=1&tab=active&from=2028-01-01')), ['APP5']);
  assert.deepEqual(ids(await list('page=1&tab=active&to=2027-12-31')), ['APP1']);
});

test('sort and paging; export returns every match', async () => {
  const p1 = await list('page=1&pageSize=1&tab=active&sort=oldest');
  const p2 = await list('page=2&pageSize=1&tab=active&sort=oldest');
  assert.deepEqual([...ids(p1), ...ids(p2)], ['APP5', 'APP1']);
  assert.equal(p1.total, 2);
  const all = await list('all=1&tab=active');
  assert.deepEqual(ids(all), ['APP1', 'APP5']);
});
