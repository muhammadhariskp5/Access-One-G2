// The day a pass ended is recorded on the pass (endedOn) when it takes an ended status, and later
// edits never move it. Passes that ended before the column existed get it from their history once.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin;
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Qatar', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const plus = (n) => { const x = new Date(`${today}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
const read = async () => {
  await srv.stop();
  const db = await openDb(dbPath);
  const rows = Object.fromEntries(db.rows(`SELECT id, status, endedOn FROM passes`).map(p => [p.id, p]));
  srv = await startServer({ dbPath });
  admin = client(srv.base);
  assert.equal((await admin.login('peadmin@test.local', 'PeAdminPass1')).status, 200);
  return rows;
};

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO locations (id, name, code, organizationId) VALUES ('L1', 'Gate', 'G', '${H}')`);
  db.run(`INSERT INTO employees (id, name, employeeId, organizationId) VALUES ('E1', 'Ann', 'A-1', '${H}'), ('E2', 'Bob', 'B-1', '${H}')`);
  db.run(`INSERT INTO passes (id, employeeId, locationId, type, status, expiryDate, organizationId, createdAt, updatedAt) VALUES
    ('LIVE', 'E1', 'L1', 'main', 'active', '${plus(100)}', '${H}', '2026-01-01', '2026-01-01'),
    ('OLD_EARLY', 'E2', 'L1', 'main', 'expired', '${plus(100)}', '${H}', '2026-01-01', '${plus(-4)}T10:00:00.000Z'),
    ('OLD_DATE', 'E2', 'L1', 'supplementary', 'expired', '${plus(-20)}', '${H}', '2026-01-01', '${plus(-2)}T10:00:00.000Z')`);
  // Passes stored before end days were recorded: the migration fills them in from their history
  db.run(`UPDATE passes SET endedOn = NULL`);
  db.run(`DELETE FROM schemaMigrations WHERE id = '2026-11-15-pass-ended-on'`);
  db.save();
  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'peadmin@test.local', password: 'PeAdminPass1', displayName: 'Pe Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  admin = client(srv.base);
  assert.equal((await admin.login('peadmin@test.local', 'PeAdminPass1')).status, 200);
});
after(async () => { await srv?.stop(); });

test('passes that ended before: ended early -> the day it was changed; by date -> its expiry', async () => {
  const s = await read();
  assert.equal(s.OLD_EARLY.endedOn, plus(-4));
  assert.equal(s.OLD_DATE.endedOn, plus(-20));
  assert.equal(s.LIVE.endedOn, null);
});

test('ending a pass early records today; a later edit does not move it; making it live clears it', async () => {
  assert.equal((await admin.patch('/api/passes/LIVE/status', { status: 'expired' })).status, 200);
  let s = await read();
  assert.equal(s.LIVE.endedOn, today);

  // Later edit of the ended pass (remarks; the form re-sends the same status)
  const db = await openDb(dbPath);
  await srv.stop();
  db.run(`UPDATE passes SET endedOn = '${plus(-9)}' WHERE id = 'LIVE'`);   // pretend it ended 9 days ago
  db.save();
  srv = await startServer({ dbPath });
  admin = client(srv.base);
  assert.equal((await admin.login('peadmin@test.local', 'PeAdminPass1')).status, 200);
  assert.equal((await admin.patch('/api/passes/LIVE', { status: 'expired', remarks: 'note added later' })).status, 200);
  s = await read();
  assert.equal(s.LIVE.endedOn, plus(-9));

  assert.equal((await admin.patch('/api/passes/LIVE/status', { status: 'active' })).status, 200);
  s = await read();
  assert.equal(s.LIVE.status, 'active');
  assert.equal(s.LIVE.endedOn, null);
});

test('the matrix date range and recent window use the recorded end day', async () => {
  const r = await admin.get(`/api/matrix?page=1&status=all_records&from=${plus(-6)}&to=${plus(-1)}`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.items.map(e => e.id), ['E2']);
  const pass = r.body.items[0].passes.find(p => p.id === 'OLD_EARLY');
  assert.equal(pass.endedOn, plus(-4));
});
