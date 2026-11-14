// The "cannot issue" message names the real cause: the person's own pass dates, or the document /
// main pass / project date that limits them.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { startServer, client, OWNER } from './helpers.mjs';

let srv, owner, loc, emp, empQid;
before(async () => {
  srv = await startServer();
  owner = client(srv.base);
  assert.equal((await owner.login(OWNER.email, OWNER.password)).status, 200);
  loc = (await owner.post('/api/locations', { name: 'Gate Q', code: 'GQ' })).body.id;
  emp = (await owner.post('/api/employees', { firstName: 'Oli', lastName: 'Test', name: 'Oli Test', employeeId: 'OLI-1', qidVisaNumber: 'QV-OLI-1', organizationId: 'org-habari' })).body.id;
  empQid = (await owner.post('/api/employees', { firstName: 'Qid', lastName: 'Short', name: 'Qid Short', employeeId: 'QS-1', qidVisaNumber: 'QV-QS-1', qidVisaExpiry: '2026-12-01', organizationId: 'org-habari' })).body.id;
});
after(async () => { await srv?.stop(); });

test("own pass dates: expiry before start is explained as the pass dates, with what to change", async () => {
  const r = await owner.post('/api/passApplications', { employeeIds: [emp], locationId: loc, startDate: '2026-11-14', individualExpiries: { [emp]: '2026-11-06' } });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /Oli Test: the pass would end 06-11-2026, before it starts \(14-11-2026\)/);
  assert.match(r.body.error, /pass expiry \(valid to\) date/);
});

test('a document date that limits the pass is named', async () => {
  const r = await owner.post('/api/passApplications', { employeeIds: [empQid], locationId: loc, startDate: '2027-01-10', endDate: '2027-12-31' });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /QID\/Visa Expiry is 01-12-2026/);
});
