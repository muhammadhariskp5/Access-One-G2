import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, OWNER } from './helpers.mjs';

let srv, admin;
before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  assert.equal((await admin.login(OWNER.email, OWNER.password)).status, 200);
});
after(async () => { await srv?.stop(); });

test('malformed email on login is a 400 with field details', async () => {
  const r = await client(srv.base).post('/api/auth/login', { email: 'not-an-email', password: 'x' });
  assert.equal(r.status, 400);
  assert.equal(r.body.fields[0].field, 'email');
});

test('employee dates must be YYYY-MM-DD', async () => {
  const bad = await admin.post('/api/employees', { firstName: 'A', lastName: 'B', name: 'A B', employeeId: 'V-1', passportExpiry: '31/12/2027' });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.fields[0].field, 'passportExpiry');
  const good = await admin.post('/api/employees', { firstName: 'A', lastName: 'B', name: 'A B', employeeId: 'V-2', passportExpiry: '2027-12-31' });
  assert.equal(good.status, 200, JSON.stringify(good.body));
});

test('clearing a date with an empty value is allowed', async () => {
  const e = (await admin.post('/api/employees', { firstName: 'C', lastName: 'D', name: 'C D', employeeId: 'V-3', passportExpiry: '2027-01-01' })).body;
  const r = await admin.patch(`/api/employees/${e.id}`, { passportExpiry: '' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
});

test('creating a location requires a name', async () => {
  assert.equal((await admin.post('/api/locations', { code: 'X' })).status, 400);
});

test('creating a pass requires employee and location', async () => {
  const r = await admin.post('/api/passes', { type: 'main', status: 'active' });
  assert.equal(r.status, 400);
  assert.deepEqual(r.body.fields.map(f => f.field).sort(), ['employeeId', 'locationId']);
});

test('invalid role values are rejected', async () => {
  const r = await admin.post('/api/users', { email: 'r@test.local', password: 'GoodPass123', displayName: 'R', role: 'superuser' });
  assert.equal(r.status, 400);
});
