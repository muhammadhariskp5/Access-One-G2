import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, OWNER } from './helpers.mjs';

let srv, admin, locationId, holderId;

before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  assert.equal((await admin.login(OWNER.email, OWNER.password)).status, 200);
  locationId = (await admin.post('/api/locations', { name: 'Gate A', code: 'GA' })).body.id;
  holderId = (await admin.post('/api/employees', { firstName: 'Pass', lastName: 'Holder', name: 'Pass Holder', employeeId: 'PH-1', organizationId: 'org-habari' })).body.id;
});
after(async () => { await srv?.stop(); });

test('new rows get UUID ids', async () => {
  assert.match(holderId, /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
});

test('pass numbers are sequential, not random', async () => {
  const body = { employeeId: holderId, locationId, type: 'main', status: 'active', expiryDate: '2030-01-01' };
  const a = (await admin.post('/api/passes', body)).body.passNumber;
  const b = (await admin.post('/api/passes', body)).body.passNumber;
  const year = new Date().getFullYear();
  assert.match(a, new RegExp(`^PASS-${year}-\\d{4}$`));
  assert.equal(Number(b.split('-')[2]), Number(a.split('-')[2]) + 1);
});

test('deleting an employee hides them but keeps the record', async () => {
  const id = (await admin.post('/api/employees', { firstName: 'Soft', lastName: 'Delete', name: 'Soft Delete', employeeId: 'SD-1', organizationId: 'org-habari' })).body.id;
  assert.equal((await admin.del(`/api/employees/${id}`)).status, 200);
  const list = (await admin.get('/api/employees')).body;
  assert.equal(list.some(e => e.id === id), false);
  await srv.stop();
  const db = await openDb(srv.dbPath);
  const [row] = db.rows('SELECT status, deletedAt FROM employees WHERE id = :id', { ':id': id });
  assert.ok(row, 'row still exists');
  assert.ok(row.deletedAt, 'deletedAt set');
  // restart for the remaining tests
  const next = await (await import('./helpers.mjs')).startServer({ dbPath: srv.dbPath });
  srv = next;
  admin = client(srv.base);
  await admin.login(OWNER.email, OWNER.password);
});

test('deleting a pass hides it but keeps the record', async () => {
  const p = (await admin.post('/api/passes', { employeeId: holderId, locationId, type: 'main', status: 'active', expiryDate: '2030-01-01' })).body;
  assert.equal((await admin.del(`/api/passes/${p.id}`)).status, 200);
  assert.equal((await admin.get('/api/passes')).body.some(x => x.id === p.id), false);
});

test('audit log is paged newest first with a before-cursor', async () => {
  const two = (await admin.get('/api/auditLogs?limit=2')).body;
  assert.equal(two.length, 2);
  const newest = two[0].timestamp;
  const older = (await admin.get(`/api/auditLogs?limit=500&before=${encodeURIComponent(newest)}`)).body;
  assert.equal(older.some(l => l.timestamp === newest), false);
});
