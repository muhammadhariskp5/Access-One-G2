// Pass lifecycle: daily job expires passes by business date, closes application lines,
// preserves end reasons, rebuilds employee links, and runs at most once per day.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, openDb, tempDbPath } from './helpers.mjs';

const dbPath = tempDbPath();
let rows;

before(async () => {
  // 1st start creates the schema; then seed directly and start again so the daily job runs.
  let srv = await startServer({ dbPath });
  await srv.stop();

  const day = 86400000;
  const ymd = d => d.toISOString().substring(0, 10);
  const yesterday = ymd(new Date(Date.now() - 2 * day)); // 2 days back: safe across timezones
  const nextYear = ymd(new Date(Date.now() + 365 * day));
  const now = new Date().toISOString();

  const db = await openDb(dbPath);
  db.run(`DELETE FROM jobRuns`);
  db.run(`INSERT INTO locations (id, name, code) VALUES ('T_LOC', 'Test Loc', 'TL')`);
  db.run(`INSERT INTO employees (id, name, employeeId) VALUES ('T_E1', 'Test One', 'TE-1'), ('T_E2', 'Test Two', 'TE-2')`);
  // App A: one person, collected, pass expired -> application closes as 'expired'
  db.run(`INSERT INTO passRequests (id, locationId, status, employeeIds, employeeStatuses, createdAt, updatedAt)
          VALUES ('T_APP_A', 'T_LOC', 'completed', '["T_E1"]', '{"T_E1":"collected"}', :n, :n)`, { ':n': now });
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, type, status, expiryDate, createdAt, updatedAt)
          VALUES ('T_P1', 'T_APP_A', 'T_E1', 'T_LOC', 'main', 'active', :y, :n, :n)`, { ':y': yesterday, ':n': now });
  // App B: E1 expired, E2 valid -> only E1's line closes
  db.run(`INSERT INTO passRequests (id, locationId, status, employeeIds, employeeStatuses, createdAt, updatedAt)
          VALUES ('T_APP_B', 'T_LOC', 'issued', '["T_E1","T_E2"]', '{"T_E1":"issued","T_E2":"issued"}', :n, :n)`, { ':n': now });
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, type, status, expiryDate, createdAt, updatedAt)
          VALUES ('T_P2', 'T_APP_B', 'T_E1', 'T_LOC', 'main', 'issued', :y, :n, :n)`, { ':y': yesterday, ':n': now });
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, type, status, expiryDate, createdAt, updatedAt)
          VALUES ('T_P3', 'T_APP_B', 'T_E2', 'T_LOC', 'main', 'issued', :x, :n, :n)`, { ':x': nextYear, ':n': now });
  // Revoked and past its date -> must stay 'revoked'
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, type, status, expiryDate, createdAt, updatedAt)
          VALUES ('T_P4', 'T_NONE', 'T_E2', 'T_LOC', 'main', 'revoked', :y, :n, :n)`, { ':y': yesterday, ':n': now });
  db.save();

  srv = await startServer({ dbPath });
  await srv.stop();
  // 3rd start: today's run is already recorded, so nothing may run again
  srv = await startServer({ dbPath });
  rows = { output: srv.output() };
  await srv.stop();

  const check = await openDb(dbPath);
  rows.passes = Object.fromEntries(check.rows(`SELECT id, status FROM passes WHERE id LIKE 'T_%'`).map(r => [r.id, r.status]));
  rows.apps = Object.fromEntries(check.rows(`SELECT id, status, employeeStatuses FROM passRequests WHERE id LIKE 'T_%'`).map(r => [r.id, r]));
  rows.links = check.rows(`SELECT requestId, employeeId, status FROM passRequestEmployees WHERE requestId LIKE 'T_%' ORDER BY requestId, employeeId`);
  rows.history = check.rows(`SELECT requestId, action FROM requestHistory WHERE requestId LIKE 'T_%'`);
  rows.jobRuns = check.rows(`SELECT id, status FROM jobRuns`);
});

test('passes past their date are expired; valid ones are untouched', () => {
  assert.equal(rows.passes.T_P1, 'expired');
  assert.equal(rows.passes.T_P2, 'expired');
  assert.equal(rows.passes.T_P3, 'issued');
});

test('an existing end reason (revoked) is never overwritten', () => {
  assert.equal(rows.passes.T_P4, 'revoked');
});

test('application closes when all its lines have ended', () => {
  assert.equal(rows.apps.T_APP_A.status, 'expired');
  assert.deepEqual(JSON.parse(rows.apps.T_APP_A.employeeStatuses), { T_E1: 'expired' });
});

test('application with a still-valid line stays open; only the ended line closes', () => {
  assert.equal(rows.apps.T_APP_B.status, 'issued');
  assert.deepEqual(JSON.parse(rows.apps.T_APP_B.employeeStatuses), { T_E1: 'expired', T_E2: 'issued' });
});

test('employee links mirror the application lines', () => {
  assert.deepEqual(rows.links.map(l => `${l.requestId}/${l.employeeId}/${l.status}`), [
    'T_APP_A/T_E1/expired', 'T_APP_B/T_E1/expired', 'T_APP_B/T_E2/issued'
  ]);
});

test('automatic closures are written to application history', () => {
  const actions = rows.history.map(h => `${h.requestId}:${h.action}`).sort();
  assert.deepEqual(actions, ['T_APP_A:AUTO_CLOSED (expired)', 'T_APP_B:AUTO_LINE_CLOSED']);
});

test('the daily job runs once per day and is recorded', () => {
  assert.equal(rows.jobRuns.length, 1);
  assert.equal(rows.jobRuns[0].status, 'done');
  assert.doesNotMatch(rows.output, /\[DailyJob\]/, 'third start must not run the job again');
  assert.doesNotMatch(rows.output, /\[Migration\] applied/, 'migrations must not re-run');
});
