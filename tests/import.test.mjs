// Spreadsheet import: dates are normalised to YYYY-MM-DD, unreadable dates are reported, and
// an org admin cannot import into another organization.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, OWNER } from './helpers.mjs';

let srv, orgAdmin, result, employees;

before(async () => {
  srv = await startServer();
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'orgadmin@test.local', password: 'OrgAdminPass1', displayName: 'Org Admin', role: 'admin', organizationId: 'org-habari' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  orgAdmin = client(srv.base);
  assert.equal((await orgAdmin.login('orgadmin@test.local', 'OrgAdminPass1')).status, 200);

  const r = await orgAdmin.post('/api/employees/batch', [
    { firstName: 'Day', lastName: 'First', name: 'Day First', employeeId: 'IMP-1', passportExpiry: '31/12/2027' },
    { firstName: 'Excel', lastName: 'Serial', name: 'Excel Serial', employeeId: 'IMP-2', qidVisaExpiry: 46000 },
    { firstName: 'Iso', lastName: 'Date', name: 'Iso Date', employeeId: 'IMP-3', visaExpiry: '2028-03-05' },
    { firstName: 'Bad', lastName: 'Date', name: 'Bad Date', employeeId: 'IMP-4', passportExpiry: '31/02/2027' },
    { firstName: 'Other', lastName: 'Org', name: 'Other Org', employeeId: 'IMP-5', organizationId: 'org-someone-else' }
  ]);
  result = r;
  employees = (await orgAdmin.get('/api/employees')).body;
});
after(async () => { await srv?.stop(); });

const byCode = code => employees.find(e => e.employeeId === code);

test('import succeeds and reports the bad row', () => {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.ok(JSON.stringify(result.body).includes('unreadable date in passportExpiry'));
});

test('DD/MM/YYYY is stored as YYYY-MM-DD', () => {
  assert.equal(byCode('IMP-1').passportExpiry, '2027-12-31');
});

test('Excel serial dates are converted', () => {
  const expected = new Date(Date.UTC(1899, 11, 30) + 46000 * 86400000).toISOString().substring(0, 10);
  assert.equal(byCode('IMP-2').qidVisaExpiry, expected);
});

test('ISO dates are kept', () => {
  assert.equal(byCode('IMP-3').visaExpiry, '2028-03-05');
});

test('impossible dates (31 Feb) are rejected, not stored', () => {
  assert.equal(byCode('IMP-4'), undefined);
});

test("an org admin's import stays in their own organization", () => {
  const e = byCode('IMP-5');
  assert.ok(e, 'row imported');
  assert.equal(e.organizationId, 'org-habari');
});
