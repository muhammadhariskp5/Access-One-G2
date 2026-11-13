// Server-side employee listing: paging, search, filters, duplicates, sort, export, tenant scope.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, OWNER } from './helpers.mjs';

let srv, owner;
const list = async (qs) => (await owner.get(`/api/employees?${qs}`));

before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  for (const name of ['Ops', 'HR']) {
    assert.equal((await owner.post('/api/divisions', { name, organizationId: 'org-habari' })).status, 200);
  }
  const rows = [
    { name: 'Alice Brown', employeeId: 'P-001', employeeType: 'Internal', status: 'active', division: 'Ops', passportNumber: 'X1' },
    { name: 'bob carter', employeeId: 'P-002', employeeType: 'External', status: 'inactive', division: 'Ops' },
    { name: 'Carol Diaz', employeeId: 'P-003', employeeType: 'External Sponsor Co', status: 'active', division: 'HR' },
    { name: 'Dan Evans', employeeId: 'P-004', employeeType: 'Internal', status: 'active', jobTitle: '50% rigger' },
    { name: 'Alice Brown', employeeId: 'P-005', employeeType: 'Internal', status: 'active' },          // duplicate name
    { name: 'Erin Fox', employeeId: 'P-006', employeeType: 'Internal', status: 'active', passportNumber: 'x1 ' }, // duplicate passport
    { name: 'Gus Hill', employeeId: 'P-007', employeeType: 'Internal', status: 'active', jobTitle: '500 rigger' },
  ].map(r => ({ firstName: r.name.split(' ')[0], lastName: r.name.split(' ')[1], organizationId: 'org-habari', ...r }));
  const r = await owner.post('/api/employees/batch', rows);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.created, 7, JSON.stringify(r.body));
});
after(async () => { await srv?.stop(); });

test('without paging parameters the full array is still returned', async () => {
  const r = await owner.get('/api/employees');
  assert.ok(Array.isArray(r.body));
  assert.equal(r.body.length, 7);
});

test('pages are stable and add up to the total', async () => {
  const p1 = (await list('page=1&pageSize=3&sort=code')).body;
  const p3 = (await list('page=3&pageSize=3&sort=code')).body;
  assert.equal(p1.total, 7);
  assert.deepEqual(p1.items.map(e => e.employeeId), ['P-001', 'P-002', 'P-003']);
  assert.deepEqual(p3.items.map(e => e.employeeId), ['P-007']);
});

test('search is case-insensitive and treats % literally', async () => {
  assert.deepEqual((await list('page=1&q=BOB')).body.items.map(e => e.employeeId), ['P-002']);
  assert.deepEqual((await list('page=1&q=50%25')).body.items.map(e => e.employeeId), ['P-004']);
});

test('filters: type (incl. sponsor), status, division', async () => {
  assert.deepEqual((await list('page=1&type=External%20Sponsor')).body.items.map(e => e.employeeId), ['P-003']);
  assert.equal((await list('page=1&status=inactive')).body.total, 1);
  assert.equal((await list('page=1&division=ops')).body.total, 2);
  assert.equal((await list('page=1&type=all&status=all')).body.total, 7);
});

test('duplicates are found across the organization, with reasons', async () => {
  const r = (await list('page=1&duplicates=1&sort=code')).body;
  assert.deepEqual(r.items.map(e => e.employeeId), ['P-001', 'P-005', 'P-006']);
  assert.equal(r.duplicateCount, 3);
  const a = r.items.find(e => e.employeeId === 'P-001');
  assert.deepEqual(a.duplicateReasons.sort(), ['Duplicate Name', 'Duplicate Passport']);
  // reasons are attached on normal pages too
  const p = (await list('page=1&pageSize=1&q=erin')).body.items[0];
  assert.deepEqual(p.duplicateReasons, ['Duplicate Passport']);
});

test('sort descending by code, and by name', async () => {
  const codes = (await list('page=1&sort=code&order=desc')).body.items.map(e => e.employeeId);
  assert.deepEqual(codes, ['P-007', 'P-006', 'P-005', 'P-004', 'P-003', 'P-002', 'P-001']);
  const names = (await list('page=1&sort=name&order=asc&q=a')).body.items.map(e => e.name);
  assert.deepEqual(names.slice(0, 2), ['Alice Brown', 'Alice Brown']);
});

test('all=1 returns every matching row for export', async () => {
  const r = (await list('all=1&status=active')).body;
  assert.equal(r.items.length, 6);
  assert.equal(r.total, 6);
});

test('unknown sort fields and huge page sizes are clamped, not injected', async () => {
  const r = await list('page=1&pageSize=99999&sort=name;DROP%20TABLE%20employees');
  assert.equal(r.status, 200);
  assert.equal(r.body.pageSize, 200);
  assert.equal((await owner.get('/api/employees')).body.length, 7);
});

test("an org admin only sees their own organization's employees", async () => {
  await owner.post('/api/employees', { firstName: 'Other', lastName: 'Tenant', name: 'Other Tenant', employeeId: 'OT-1', organizationId: 'org-elsewhere' });
  const created = await owner.post('/api/users', { email: 'pageadmin@test.local', password: 'PageAdminPass1', displayName: 'Page Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  const orgAdmin = client(srv.base);
  assert.equal((await orgAdmin.login('pageadmin@test.local', 'PageAdminPass1')).status, 200);
  const r = (await orgAdmin.get('/api/employees?page=1&q=tenant')).body;
  assert.equal(r.total, 0);
});
