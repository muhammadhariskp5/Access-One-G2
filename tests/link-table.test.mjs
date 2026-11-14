// The link table (passRequestEmployees) is the record of who is on each application: API reads come
// from it, saves write it (and, for rollback safety, also keep the old JSON columns in step).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, owner, locationId, appId;
const ids = {};
const getApp = async () => (await owner.get('/api/passApplications')).body.find(a => a.id === appId);
const links = async () => {
  await srv.stop();
  const db = await openDb(dbPath);
  const rows = db.rows(`SELECT employeeId, status, expiryDate, startDate, sortOrder FROM passRequestEmployees WHERE requestId = '${appId}' ORDER BY sortOrder`);
  const json = db.rows(`SELECT employeeIds, employeeStatuses FROM passRequests WHERE id = '${appId}'`)[0];
  srv = await startServer({ dbPath });
  owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  return { rows, json };
};

before(async () => {
  srv = await startServer({ dbPath });
  owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  locationId = (await owner.post('/api/locations', { name: 'Gate L', code: 'GL' })).body.id;
  for (const n of ['Cee', 'Ay', 'Bee']) {
    ids[n] = (await owner.post('/api/employees', { firstName: n, lastName: 'Link', name: `${n} Link`, employeeId: `LNK-${n}`, organizationId: 'org-habari' })).body.id;
  }
  const created = await owner.post('/api/passApplications', {
    employeeIds: [ids.Cee, ids.Ay, ids.Bee], locationId, endDate: '2030-01-01',
    individualExpiries: { [ids.Ay]: '2029-06-30' }, individualStartDates: { [ids.Bee]: '2026-12-01' },
  });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  appId = created.body.id;
});
after(async () => { await srv?.stop(); });

test('a new application: one link row per person, in list order, with own dates', async () => {
  const { rows, json } = await links();
  assert.deepEqual(rows.map(r => r.employeeId), [ids.Cee, ids.Ay, ids.Bee]);
  assert.equal(rows.find(r => r.employeeId === ids.Ay).expiryDate, '2029-06-30');
  assert.equal(rows.find(r => r.employeeId === ids.Bee).startDate, '2026-12-01');
  assert.deepEqual(JSON.parse(json.employeeIds), [ids.Cee, ids.Ay, ids.Bee]);   // JSON copy kept in step
  const app = await getApp();
  assert.deepEqual(app.employeeIds, [ids.Cee, ids.Ay, ids.Bee]);
  assert.equal(app.individualExpiries[ids.Ay], '2029-06-30');
});

test('reads come from the link table, not the JSON columns', async () => {
  await srv.stop();
  const db = await openDb(dbPath);
  db.run(`UPDATE passRequests SET employeeIds = '["ghost"]', employeeStatuses = '{"ghost":"rejected"}' WHERE id = '${appId}'`);
  db.save();
  srv = await startServer({ dbPath });
  owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const app = await getApp();
  assert.deepEqual(app.employeeIds, [ids.Cee, ids.Ay, ids.Bee]);
  assert.ok(!('ghost' in app.employeeStatuses));
});

test('editing people writes the link table (removal, new order, statuses)', async () => {
  const r = await owner.patch(`/api/passApplications/${appId}`, {
    employeeIds: [ids.Bee, ids.Cee], employeeStatuses: { [ids.Cee]: 'processing' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const { rows, json } = await links();
  assert.deepEqual(rows.map(r => r.employeeId), [ids.Bee, ids.Cee]);
  assert.equal(rows.find(r => r.employeeId === ids.Cee).status, 'processing');
  assert.equal(rows.find(r => r.employeeId === ids.Bee).status, null);     // follows the application
  assert.deepEqual(JSON.parse(json.employeeIds), [ids.Bee, ids.Cee]);
  const app = await getApp();
  assert.deepEqual(app.employeeIds, [ids.Bee, ids.Cee]);
  assert.equal(app.employeeStatuses[ids.Cee], 'processing');
  assert.equal(app.individualStartDates[ids.Bee], '2026-12-01');            // untouched fields kept
});

test('a per-person status change is saved on the link row and rolls up', async () => {
  const r = await owner.patch(`/api/passApplications/${appId}/employeeStatus`, { employeeIds: [ids.Bee, ids.Cee], status: 'accepted' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const app = await getApp();
  assert.equal(app.employeeStatuses[ids.Bee], 'accepted');
  assert.equal(app.employeeStatuses[ids.Cee], 'accepted');
  assert.equal(app.status, 'accepted');
});

test('deleting an employee cancels their line on the link table', async () => {
  assert.equal((await owner.del(`/api/employees/${ids.Cee}`)).status, 200);
  const app = await getApp();
  assert.equal(app.employeeStatuses[ids.Cee], 'cancelled');
  const { rows } = await links();
  assert.equal(rows.find(r => r.employeeId === ids.Cee).status, 'cancelled');
});
