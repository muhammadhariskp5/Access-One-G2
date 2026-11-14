// Scoped records (POST /api/scope) for the application workspace and form: the people involved,
// found by application, ID, import identifier or search, with all their passes and applications.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, openDb, tempDbPath, OWNER } from './helpers.mjs';

const dbPath = tempDbPath();
let srv, admin;
const scope = async (body) => {
  const r = await admin.post('/api/scope', body);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return {
    emps: r.body.employees.map(e => e.id).sort(),
    passes: r.body.passes.map(p => p.id).sort(),
    apps: r.body.applications.map(a => a.id).sort(),
    body: r.body,
  };
};

before(async () => {
  srv = await startServer({ dbPath });
  await srv.stop();
  const H = 'org-habari';
  const db = await openDb(dbPath);
  db.run(`INSERT INTO locations (id, name, code, organizationId) VALUES ('L1', 'Alpha Gate', 'AG', '${H}'), ('L2', 'Zulu Yard', 'ZY', '${H}')`);
  db.run(`INSERT INTO employees (id, name, employeeId, qatarId, status, organizationId) VALUES
    ('E1', 'Zara Young', 'Z-1', 'Q111', 'active', '${H}'), ('E2', 'Adam Bell', 'A-2', NULL, 'active', '${H}'),
    ('E3', 'Ivy Inactive', 'I-3', NULL, 'inactive', '${H}'), ('E4', 'Other Org', 'O-4', NULL, 'active', 'org-elsewhere')`);
  db.run(`INSERT INTO passRequests (id, authorityAppNumber, locationId, status, type, employeeIds, employeeStatuses, organizationId, createdAt) VALUES
    ('APP1', 'AUTH-77', 'L1', 'processing', 'main', '["E1"]', '{}', '${H}', '2026-10-01'),
    ('APP2', NULL, 'L2', 'pending', 'main', '["E1","E2"]', '{"E2":"accepted"}', '${H}', '2026-10-02'),
    ('APPX', NULL, 'L1', 'pending', 'main', '["E4"]', '{}', 'org-elsewhere', '2026-10-02')`);
  db.run(`INSERT INTO passes (id, requestId, employeeId, locationId, type, status, organizationId, createdAt) VALUES
    ('P1', 'APP1', 'E1', 'L1', 'main', 'active', '${H}', '2026-10-03'),
    ('P2', NULL, 'E2', 'L2', 'main', 'active', '${H}', '2026-10-03'),
    ('PX', NULL, 'E4', 'L1', 'main', 'active', 'org-elsewhere', '2026-10-03')`);
  db.run(`DELETE FROM passRequestEmployees`);
  db.run(`DELETE FROM schemaMigrations WHERE id = '2026-11-14-link-table-people'`);
  db.save();

  srv = await startServer({ dbPath });
  const owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  const created = await owner.post('/api/users', { email: 'scopeadmin@test.local', password: 'ScopeAdminPass1', displayName: 'Scope Admin', role: 'admin', organizationId: 'org-habari' });
  await owner.patch(`/api/users/${created.body.id}`, { status: 'active' });
  admin = client(srv.base);
  assert.equal((await admin.login('scopeadmin@test.local', 'ScopeAdminPass1')).status, 200);
});
after(async () => { await srv?.stop(); });

test('an application (by ID in any case, or authority number) brings its people and all their records', async () => {
  for (const key of ['app1', 'AUTH-77']) {
    const r = await scope({ applicationIds: [key] });
    assert.deepEqual(r.emps, ['E1']);
    assert.deepEqual(r.passes, ['P1']);
    assert.deepEqual(r.apps, ['APP1', 'APP2']);           // E1 is also on APP2: the rules must see it
  }
  const app2 = (await scope({ applicationIds: ['APP2'] })).body.applications.find(a => a.id === 'APP2');
  assert.deepEqual(app2.employeeIds, ['E1', 'E2']);
  assert.equal(app2.employeeStatuses.E2, 'accepted');
});

test('people by import identifier', async () => {
  assert.deepEqual((await scope({ identifiers: ['Q111'] })).emps, ['E1']);
  assert.deepEqual((await scope({ identifiers: ['A-2'] })).passes, ['P2']);
});

test('picker search: active people of this organization only', async () => {
  assert.deepEqual((await scope({ q: 'adam' })).emps, ['E2']);
  assert.deepEqual((await scope({ q: '' })).emps, ['E1', 'E2']);
  assert.deepEqual((await scope({ q: 'ivy' })).emps, []);
});

test('never returns another organization\'s records', async () => {
  const r = await scope({ employeeIds: ['E4'], applicationIds: ['APPX'], identifiers: ['O-4'] });
  assert.deepEqual([r.emps, r.passes, r.apps], [[], [], []]);
});
