// Delta list refresh: the database stamps every change (trigger), full lists hand out a cursor,
// and ?since=<cursor> returns only rows changed since then, with deletions listed separately.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
const OLD = '2020-01-01T00:00:00.000Z';
let srv, owner, cursor;
const ids = (r) => r.body.items.map(x => x.id).sort();

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  // Two employees last changed long ago (setting syncAt explicitly is not re-stamped)
  const db = await openDb(dbPath);
  db.run(`INSERT INTO employees (id, name, firstName, lastName, employeeId, organizationId) VALUES
    ('OLD1', 'Old One', 'Old', 'One', 'OLD-1', 'org-habari'), ('OLD2', 'Old Two', 'Old', 'Two', 'OLD-2', 'org-habari')`);
  db.run(`UPDATE employees SET syncAt = '${OLD}'`);
  db.run(`UPDATE passRequests SET syncAt = '${OLD}'`);
  assert.equal(db.rows(`SELECT syncAt FROM employees WHERE id = 'OLD1'`)[0].syncAt, OLD);
  db.save();

  srv = await startServer({ dbPath });
  owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
});
after(async () => { await srv?.stop(); });

test('the full list is unchanged and hands out a sync cursor', async () => {
  const r = await owner.get('/api/employees');
  assert.ok(Array.isArray(r.body));
  assert.ok(r.body.some(e => e.id === 'OLD1'));
  cursor = r.headers.get('x-sync-cursor');
  assert.match(cursor || '', /^\d{4}-\d{2}-\d{2}T/);
});

test('a delta returns only what changed since the cursor', async () => {
  const quiet = await owner.get(`/api/employees?since=${encodeURIComponent(cursor)}`);
  assert.equal(quiet.status, 200);
  assert.deepEqual(quiet.body.removed, []);
  assert.ok(!ids(quiet).includes('OLD1') && !ids(quiet).includes('OLD2'));

  const upd = await owner.patch('/api/employees/OLD1', { name: 'Old One Renamed', firstName: 'Old', lastName: 'One', employeeId: 'OLD-1' });
  assert.equal(upd.status, 200, JSON.stringify(upd.body));
  const d = await owner.get(`/api/employees?since=${encodeURIComponent(cursor)}`);
  assert.ok(ids(d).includes('OLD1'));
  assert.ok(!ids(d).includes('OLD2'));
  assert.equal(d.body.items.find(e => e.id === 'OLD1').name, 'Old One Renamed');
  assert.match(d.body.cursor, /^\d{4}-\d{2}-\d{2}T/);
});

test('writes that never touch updatedAt are still seen (the trigger stamps them)', async () => {
  const before = await owner.get(`/api/employees?since=${encodeURIComponent(cursor)}`);
  assert.ok(!ids(before).includes('OLD2'));
  assert.equal((await owner.patch('/api/employees/bulk-status', { ids: ['OLD2'], status: 'inactive' })).status, 200);
  const d = await owner.get(`/api/employees?since=${encodeURIComponent(cursor)}`);
  assert.equal(d.body.items.find(e => e.id === 'OLD2')?.status, 'inactive');
});

test('a deletion comes back in removed', async () => {
  assert.equal((await owner.del('/api/employees/OLD2')).status, 200);
  const d = await owner.get(`/api/employees?since=${encodeURIComponent(cursor)}`);
  assert.ok(d.body.removed.includes('OLD2'));
  assert.ok(!ids(d).includes('OLD2'));
});

test('applications and passes support deltas too, in the full-list shape', async () => {
  const appsCursor = (await owner.get('/api/passApplications')).headers.get('x-sync-cursor');
  const passCursor = (await owner.get('/api/passes')).headers.get('x-sync-cursor');
  assert.ok(appsCursor && passCursor);
  const locationId = (await owner.post('/api/locations', { name: 'Gate S', code: 'GS' })).body.id;
  const created = await owner.post('/api/passApplications', { employeeIds: ['OLD1'], locationId, endDate: '2030-01-01' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  const d = await owner.get(`/api/passApplications?since=${encodeURIComponent(appsCursor)}`);
  const row = d.body.items.find(a => a.id === created.body.id);
  assert.ok(row);
  assert.deepEqual(row.employeeIds, ['OLD1']);          // JSON fields parsed like the full list
  const p = await owner.get(`/api/passes?since=${encodeURIComponent(passCursor)}`);
  assert.equal(p.status, 200);
  assert.ok(Array.isArray(p.body.items) && Array.isArray(p.body.removed));
});

test('a malformed cursor is rejected', async () => {
  assert.equal((await owner.get('/api/employees?since=yesterday')).status, 400);
});
