// Access code bulk import: locations by ID, code or name; existing codes skipped; bad rows reported
// per row; nothing from another organization.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin, result;

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO locations (id, name, code, organizationId) VALUES ('L1', 'Alpha Gate', 'AG', '${H}'), ('LX', 'Other Site', 'OS', 'org-elsewhere')`);
  db.run(`INSERT INTO accessCodes (id, areaCode, accessArea, locationId, organizationId, status) VALUES ('AC0', 'A-1', 'Existing', 'L1', '${H}', 'active')`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'acadmin@test.local', password: 'AcAdminPass1', displayName: 'Ac Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  admin = client(srv.base);
  assert.equal((await admin.login('acadmin@test.local', 'AcAdminPass1')).status, 200);

  result = await admin.post('/api/accessCodes/batch', [
    { rowNumber: 2, location: 'L1', areaCode: 'B-1', accessArea: 'Berth 1' },          // by ID
    { rowNumber: 3, location: 'ag', areaCode: 'B-2', accessArea: 'Berth 2' },          // by code
    { rowNumber: 4, location: 'Alpha Gate', areaCode: 'B-3', accessArea: 'Berth 3' },  // by name
    { rowNumber: 5, location: 'L1', areaCode: 'a-1', accessArea: 'Dup' },              // exists already
    { rowNumber: 6, location: 'Nowhere', areaCode: 'B-4', accessArea: 'Berth 4' },     // unknown location
    { rowNumber: 7, location: 'LX', areaCode: 'B-5', accessArea: 'Berth 5' },          // other organization
    { rowNumber: 8, location: 'L1', areaCode: 'X'.repeat(60), accessArea: 'Too long' },
    { rowNumber: 9, location: 'L1', areaCode: 'B-1', accessArea: 'Same as row 2' },    // duplicate in file
  ]);
});
after(async () => { await srv?.stop(); });

test('valid rows are imported; locations found by ID, code or name', async () => {
  assert.equal(result.status, 200, JSON.stringify(result.body));
  assert.equal(result.body.created, 3);
  const codes = (await admin.get('/api/accessCodes')).body.map(c => c.areaCode).sort();
  assert.deepEqual(codes, ['A-1', 'B-1', 'B-2', 'B-3']);
});

test('existing codes (and repeats within the file) are skipped', () => {
  assert.deepEqual(result.body.skipped.map(r => r.row), [5, 9]);
});

test('bad rows are reported by row with a reason', () => {
  const byRow = Object.fromEntries(result.body.rejected.map(r => [r.row, r.reason]));
  assert.match(byRow[6], /Unknown location "Nowhere"/);
  assert.match(byRow[7], /Unknown location "LX"/);
  assert.match(byRow[8], /longer than 50/);
});

test('a file with nothing valid is refused with the reasons', async () => {
  const r = await admin.post('/api/accessCodes/batch', [{ rowNumber: 2, location: 'Nowhere', areaCode: 'Z', accessArea: 'Z' }]);
  assert.equal(r.status, 400);
  assert.equal(r.body.rejected.length, 1);
  assert.match(r.body.error, /No access codes imported/);
});
