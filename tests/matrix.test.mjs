// Access Matrix on the server (GET /api/matrix): the screen's rules for who appears, as SQL.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plus = (n) => { const x = new Date(`${today}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const ids = async (qs) => {
  const r = await admin.get(`/api/matrix?${qs}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.items.map(e => e.id);
};

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO categories (id, name, organizationId) VALUES ('C1', 'Ports', '${H}'), ('C2', 'Plants', '${H}')`);
  db.run(`INSERT INTO locations (id, name, code, categoryId, organizationId) VALUES ('L1', 'Alpha Gate', 'AG', 'C1', '${H}'), ('L2', 'Zulu Yard', 'ZY', 'C2', '${H}')`);
  db.run(`INSERT INTO employees (id, name, employeeId, jobTitle, organizationId) VALUES
    ('VALID', 'Ann Valid', 'V-1', 'Rigger', '${H}'),
    ('RECENT', 'Bob Recent', 'R-1', 'Welder', '${H}'),
    ('OLDEXP', 'Cat OldExpired', 'O-1', 'Driver', '${H}'),
    ('REPL', 'Dan Replaced', 'P-1', 'Fitter', '${H}'),
    ('NOPASS', 'Eve NoPass', 'N-1', 'Helper', '${H}'),
    ('ODD', 'Fay OddDate', 'F-1', 'Painter', '${H}'),
    ('OTHER', 'Zed OtherOrg', 'X-1', 'Rigger', 'org-elsewhere')`);
  db.run(`INSERT INTO passes (id, employeeId, locationId, type, status, expiryDate, accessCodes, remarks, organizationId, createdAt, updatedAt) VALUES
    ('P_V', 'VALID', 'L1', 'main', 'active', '${plus(200)}', '["GATE-9"]', NULL, '${H}', '2026-01-01', '2026-01-01'),
    ('P_R', 'RECENT', 'L2', 'main', 'active', '${plus(-10)}', '[]', NULL, '${H}', '2026-01-01', '2026-01-01'),
    ('P_O', 'OLDEXP', 'L1', 'main', 'expired', '${plus(-200)}', '[]', NULL, '${H}', '2026-01-01', '2026-01-01'),
    ('P_P', 'REPL', 'L1', 'main', 'replaced', '${plus(100)}', '[]', NULL, '${H}', '2026-01-01', '2026-01-01'),
    ('P_X', 'OTHER', 'L1', 'main', 'active', '${plus(100)}', '[]', NULL, 'org-elsewhere', '2026-01-01', '2026-01-01'),
    ('P_D', 'ODD', 'L1', 'main', ' Active ', '1/5/2099', '[]', NULL, '${H}', '2026-01-01', '2026-01-01')`);
  // One-digit day/month date, stored before dates were normalized: the migration converts it
  db.run(`DELETE FROM schemaMigrations WHERE id = '2026-11-14-normalize-dates'`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'mxadmin@test.local', password: 'MxAdminPass1', displayName: 'Mx Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  admin = client(srv.base);
  assert.equal((await admin.login('mxadmin@test.local', 'MxAdminPass1')).status, 200);
});
after(async () => { await srv?.stop(); });

test('default view: valid passes, plus expiries within the window; own org only', async () => {
  assert.deepEqual(await ids('page=1&status=active&expiredDays=30'), ['VALID', 'RECENT', 'ODD']);
  assert.deepEqual(await ids('page=1&status=active&expiredDays=0'), ['VALID', 'ODD']);       // window off
  assert.deepEqual(await ids('page=1&status=active&expiredDays=365'), ['VALID', 'RECENT', 'OLDEXP', 'ODD']);
});

test('other status views', async () => {
  assert.deepEqual(await ids('page=1&status=expired'), ['RECENT', 'OLDEXP']);
  assert.deepEqual(await ids('page=1&status=replaced'), ['REPL']);
  assert.deepEqual(await ids('page=1&status=no_valid_pass'), ['RECENT', 'OLDEXP', 'REPL', 'NOPASS']);
  assert.deepEqual(await ids('page=1&status=all_records'), ['VALID', 'RECENT', 'OLDEXP', 'REPL', 'ODD']);
});

test('search matches person fields, pass location and access codes; category filters', async () => {
  assert.deepEqual(await ids('page=1&status=active&expiredDays=30&q=welder'), ['RECENT']);
  assert.deepEqual(await ids('page=1&status=active&expiredDays=30&q=zulu'), ['RECENT']);
  assert.deepEqual(await ids('page=1&status=active&expiredDays=30&q=gate-9'), ['VALID']);
  assert.deepEqual(await ids('page=1&status=active&expiredDays=30&category=C2'), ['RECENT']);
});

test('date range, sort, paging; each row carries its passes', async () => {
  assert.deepEqual(await ids(`page=1&status=all_records&from=${plus(0)}`), ['VALID', 'REPL', 'ODD']);
  assert.deepEqual(await ids('page=1&status=all_records&sort=name&order=desc'), ['ODD', 'REPL', 'OLDEXP', 'RECENT', 'VALID']);
  const p2 = await admin.get('/api/matrix?page=2&pageSize=1&status=active&expiredDays=30');
  assert.equal(p2.body.total, 3);
  assert.deepEqual(p2.body.items.map(e => e.id), ['RECENT']);
  assert.deepEqual(p2.body.items[0].passes.map(p => p.id), ['P_R']);
  assert.deepEqual(p2.body.items[0].passes[0].accessCodes, []);
});

test('stored dates are converted to YYYY-MM-DD', async () => {
  const r = await admin.get('/api/matrix?page=1&status=active&expiredDays=0&q=painter');
  assert.equal(r.body.items[0].passes[0].expiryDate, '2099-05-01');
});
