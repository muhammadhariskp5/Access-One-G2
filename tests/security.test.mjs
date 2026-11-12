import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, OWNER } from './helpers.mjs';

let srv, admin, viewer, viewerId;

before(async () => {
  srv = await startServer();
  admin = client(srv.base);
  const login = await admin.login(OWNER.email, OWNER.password);
  assert.equal(login.status, 200, JSON.stringify(login.body));

  const created = await admin.post('/api/users', { email: 'v@test.local', password: 'ViewerPass123', displayName: 'Viewer', role: 'viewer', organizationId: 'org-habari' });
  assert.equal(created.status, 200, JSON.stringify(created.body));
  viewerId = created.body.id;
  await admin.patch(`/api/users/${viewerId}`, { status: 'active' });
  viewer = client(srv.base);
  assert.equal((await viewer.login('v@test.local', 'ViewerPass123')).status, 200);
});
after(async () => { await srv?.stop(); });

test('login uses an httpOnly cookie and returns no token', async () => {
  const c = client(srv.base);
  const r = await fetch(srv.base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-Requested-With': 'AccessOne' },
    body: JSON.stringify(OWNER)
  });
  const body = await r.json();
  assert.equal(body.token, undefined);
  assert.match(r.headers.get('set-cookie') || '', /ao_session=.*HttpOnly/i);
  assert.equal(c.hasSession(), false);
});

test('reads need a session', async () => {
  assert.equal((await client(srv.base).get('/api/users')).status, 401);
  assert.equal((await admin.get('/api/users')).status, 200);
});

test('writes without the CSRF header are rejected', async () => {
  const r = await admin.post('/api/categories', { name: 'x' }, { 'X-Requested-With': '' });
  assert.equal(r.status, 403);
});

test('spoofed identity header without a session cannot change users', async () => {
  const r = await client(srv.base).patch(`/api/users/${viewerId}`, { role: 'admin' }, { 'x-user-id': viewerId });
  assert.equal(r.status, 401);
});

test('a user cannot escalate their own role, status or organization', async () => {
  await viewer.patch(`/api/users/${viewerId}`, { role: 'admin', status: 'active', organizationId: 'other' });
  const users = (await admin.get('/api/users')).body;
  const me = users.find(u => u.id === viewerId);
  assert.equal(me.role, 'viewer');
  assert.equal(me.organizationId, 'org-habari');
});

test('a non-admin cannot edit another user (and cannot probe IDs)', async () => {
  assert.equal((await viewer.patch('/api/users/does-not-exist', { displayName: 'x' })).status, 403);
});

test('unknown field names are ignored, not put into SQL', async () => {
  const r = await viewer.patch(`/api/users/${viewerId}`, { 'displayName = (SELECT 1) --': 'x' });
  assert.equal(r.status, 200);
});

test('changing your own password requires the current one', async () => {
  assert.equal((await viewer.patch(`/api/users/${viewerId}`, { password: 'NewViewerPass1' })).status, 400);
  assert.equal((await viewer.patch(`/api/users/${viewerId}`, { password: 'NewViewerPass1', currentPassword: 'ViewerPass123' })).status, 200);
});

test('admin reset generates a random temporary password', async () => {
  const r = await admin.post(`/api/users/${viewerId}/reset-password`, {});
  assert.equal(r.status, 200);
  assert.match(r.body.temporaryPassword, /^[A-Za-z0-9_-]{12}$/);
});

test('short passwords are rejected when creating users', async () => {
  const r = await admin.post('/api/users', { email: 's@test.local', password: 'short', displayName: 'S', role: 'viewer' });
  assert.equal(r.status, 400);
});

test('self-registration creates a pending viewer and no session', async () => {
  const c = client(srv.base);
  const r = await c.post('/api/auth/register', { email: 'new@test.local', password: 'NewUserPass1', displayName: 'New Person' });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, 'pending');
  assert.equal(r.body.role, 'viewer');
  assert.equal(r.body.token, undefined);
  assert.equal(c.hasSession(), false);
});

test('logout ends the session', async () => {
  const c = client(srv.base);
  await c.login(OWNER.email, OWNER.password);
  assert.equal((await c.get('/api/users')).status, 200);
  await c.post('/api/auth/logout', {});
  assert.equal((await c.get('/api/users')).status, 401);
});

test('repeated failed logins for one email are rate limited', async () => {
  const c = client(srv.base);
  let last;
  for (let i = 0; i < 11; i++) last = await c.login('brute@test.local', 'wrongwrong');
  assert.equal(last.status, 429);
});
