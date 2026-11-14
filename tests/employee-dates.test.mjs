// Employee document dates an old import stored wrongly (an Excel date number saved as the year)
// are repaired, so the employee can be edited again; validation errors name the field.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin;

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO employees (id, name, firstName, lastName, employeeId, qidVisaNumber, organizationId, qidVisaExpiry, passportExpiry, visaExpiry, safetyInductionDate) VALUES
    ('B1', 'Bibek Test Pun', 'Bibek', 'Pun', 'BP-1', 'QV-BP1', '${H}', '46261-12-31', '+048891-01-01T00:00:00.000Z', '31/12/2026', 'not a date'),
    ('OK', 'Fine Person', 'Fine', 'Person', 'FP-1', 'QV-FP1', '${H}', '2027-03-04', '2030-01-01', NULL, NULL)`);
  db.run(`INSERT INTO departments (id, name, organizationId) VALUES ('D1', 'OPERATIONS', '${H}')`);
  db.run(`UPDATE employees SET department = 'OPERSTIONS' WHERE id = 'B1'`);    // old typo
  db.run(`DELETE FROM schemaMigrations WHERE id = '2026-11-14-repair-employee-dates'`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'edadmin@test.local', password: 'EdAdminPass1', displayName: 'Ed Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  admin = client(srv.base);
  assert.equal((await admin.login('edadmin@test.local', 'EdAdminPass1')).status, 200);
});
after(async () => { await srv?.stop(); });

test('Excel date numbers stored as years become the real dates; others normalized or cleared', async () => {
  const e = (await admin.get('/api/employees/B1')).body;
  assert.equal(e.qidVisaExpiry, '2026-08-27');     // serial 46261
  assert.equal(e.passportExpiry, '2033-11-08');    // serial 48891
  assert.equal(e.visaExpiry, '2026-12-31');        // DD/MM/YYYY
  assert.equal(e.safetyInductionDate ?? null, null); // unreadable: cleared
  const ok = (await admin.get('/api/employees/OK')).body;
  assert.equal(ok.qidVisaExpiry, '2027-03-04');    // good values untouched
});

test('the repaired employee can be edited again', async () => {
  const r = await admin.patch('/api/employees/B1', { firstName: 'Bibek', lastName: 'Pun', employeeId: 'BP-1', qidVisaExpiry: '2027-08-27', passportExpiry: '2033-11-08' });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await admin.get('/api/employees/B1')).body.qidVisaExpiry, '2027-08-27');
});

test('a rejected save names the field', async () => {
  const r = await admin.patch('/api/employees/B1', { qidVisaExpiry: '31-12-46261' });
  assert.equal(r.status, 400);
  assert.ok(r.body.fields.some(f => f.field === 'qidVisaExpiry'));
});

test('an old invalid department does not block saving other fields; a new invalid one is refused', async () => {
  const keep = await admin.patch('/api/employees/B1', { firstName: 'Bibek', department: 'OPERSTIONS', jobTitle: 'Rigger' });
  assert.equal(keep.status, 200, JSON.stringify(keep.body));
  const bad = await admin.patch('/api/employees/B1', { department: 'NOT-A-DEPT' });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Invalid Department/);
  const fix = await admin.patch('/api/employees/B1', { department: 'OPERATIONS' });
  assert.equal(fix.status, 200, JSON.stringify(fix.body));
});
