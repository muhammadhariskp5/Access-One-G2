// Deleting an employee cancels their open application lines on the application itself, so a later
// edit of the application can't bring the cancellation back.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, OWNER } from './helpers.mjs';

let srv, owner, locationId, e1, e2, appId;
const getApp = async () => (await owner.get('/api/passApplications')).body.find(a => a.id === appId);
const history = async () => (await owner.get(`/api/passApplications/${appId}/history`)).body;

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  locationId = (await owner.post('/api/locations', { name: 'Gate D', code: 'GD' })).body.id;
  const mk = async (n) => (await owner.post('/api/employees', { firstName: n, lastName: 'Del', name: `${n} Del`, employeeId: `DEL-${n}`, organizationId: 'org-habari' })).body.id;
  e1 = await mk('One');
  e2 = await mk('Two');
  const created = await owner.post('/api/passApplications', { employeeIds: [e1, e2], locationId, endDate: '2030-01-01' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  appId = created.body.id;
});
after(async () => { await srv?.stop(); });

test('deleting one person cancels only their line, on the application itself', async () => {
  assert.equal((await owner.del(`/api/employees/${e1}`)).status, 200);
  const app = await getApp();
  assert.equal(app.employeeStatuses[e1], 'cancelled');
  assert.notEqual(app.employeeStatuses[e2], 'cancelled');
  assert.notEqual(app.status, 'cancelled');
});

test('a later edit of the application keeps the cancellation', async () => {
  const r = await owner.patch(`/api/passApplications/${appId}`, { remarks: 'edited after delete' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await getApp()).employeeStatuses[e1], 'cancelled');
});

test('deleting the last person cancels the application, with history', async () => {
  assert.equal((await owner.del(`/api/employees/${e2}`)).status, 200);
  const app = await getApp();
  assert.equal(app.employeeStatuses[e2], 'cancelled');
  assert.equal(app.status, 'cancelled');
  const h = await history();
  assert.ok(Array.isArray(h));
  assert.ok(h.some(x => (x.action || x.ACTION) === 'EMPLOYEE_DELETED'), JSON.stringify(h));
});
