import crypto from 'crypto';

// --- People on an application: the passRequestEmployees link table ---
// One row per person on an application: their own status (NULL = follows the application's
// status), own expiry and start date (NULL = the application's dates apply) and their place in
// the list. API responses build employeeIds / employeeStatuses / individualExpiries /
// individualStartDates from these rows (readPeople), so the response shape is unchanged.

export interface AppPeople {
  employeeIds: string[];
  employeeStatuses: Record<string, string>;
  individualExpiries: Record<string, string>;
  individualStartDates: Record<string, string>;
}

const parseJson = <T,>(v: unknown, fallback: T): T => {
  if (v === null || v === undefined || v === '') return fallback;
  try { return (JSON.parse(String(v)) ?? fallback) as T; } catch { return fallback; }
};
const str50 = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v).slice(0, 50));

// Make the link rows of one application match `people` (incremental: inserts people added,
// deletes people removed, updates changed rows). Runs inside the caller's transaction.
export async function writePeople(connection: any, requestId: string, people: AppPeople): Promise<void> {
  const oracledb = (await import("oracledb")).default;
  const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  type Want = { status: string | null; expiry: string | null; start: string | null; order: number };
  const desired = new Map<string, Want>();
  people.employeeIds.forEach((empId, i) => {
    const id = String(empId || '');
    if (!id || desired.has(id)) return;
    desired.set(id, {
      status: str50(people.employeeStatuses?.[id]),
      expiry: str50(people.individualExpiries?.[id]),
      start: str50(people.individualStartDates?.[id]),
      order: i,
    });
  });

  const cur = await connection.execute(
    `SELECT id, employeeId, status, expiryDate, startDate, sortOrder FROM passRequestEmployees WHERE requestId = :id`,
    [requestId], opts
  );
  const seen = new Set<string>();
  for (const row of (cur.rows || []) as any[]) {
    const g = (k: string) => row[k.toUpperCase()] ?? row[k] ?? null;
    const empId = String(g('employeeId') || '');
    const want = desired.get(empId);
    if (!want || seen.has(empId)) {
      // Person removed from the application (or a duplicate row)
      await connection.execute(`DELETE FROM passRequestEmployees WHERE id = :id`, [g('id')]);
      continue;
    }
    seen.add(empId);
    const same = str50(g('status')) === want.status && str50(g('expiryDate')) === want.expiry &&
      str50(g('startDate')) === want.start && Number(g('sortOrder')) === want.order && g('sortOrder') !== null;
    if (!same) {
      await connection.execute(
        `UPDATE passRequestEmployees SET status = :status, expiryDate = :expiryDate, startDate = :startDate, sortOrder = :sortOrder WHERE id = :id`,
        { status: want.status, expiryDate: want.expiry, startDate: want.start, sortOrder: want.order, id: g('id') }
      );
    }
  }
  for (const [empId, want] of desired) {
    if (seen.has(empId)) continue;
    // Only for an existing employee: a stale ID must not create a dangling link (or, with foreign
    // keys enforced, make every edit of the application fail).
    await connection.execute(
      `INSERT INTO passRequestEmployees (id, requestId, employeeId, status, expiryDate, startDate, sortOrder)
       SELECT :id, :requestId, e.id, :status, :expiryDate, :startDate, :sortOrder FROM employees e WHERE e.id = :employeeId`,
      { id: crypto.randomUUID(), requestId, employeeId: empId, status: want.status, expiryDate: want.expiry, startDate: want.start, sortOrder: want.order }
    );
  }
}

// The people of these applications, from the link table (in list order).
export async function readPeople(connection: any, requestIds: string[]): Promise<Map<string, AppPeople>> {
  const out = new Map<string, AppPeople>();
  const ids = Array.from(new Set(requestIds.map(String).filter(Boolean)));
  for (const id of ids) out.set(id, { employeeIds: [], employeeStatuses: {}, individualExpiries: {}, individualStartDates: {} });
  if (ids.length === 0) return out;
  const oracledb = (await import("oracledb")).default;
  for (let i = 0; i < ids.length; i += 500) {
    const chunk = ids.slice(i, i + 500);
    const binds: Record<string, string> = {};
    chunk.forEach((id, j) => { binds[`r${j}`] = id; });
    const res = await connection.execute(
      `SELECT requestId, employeeId, status, expiryDate, startDate FROM passRequestEmployees
        WHERE requestId IN (${chunk.map((_, j) => `:r${j}`).join(', ')})
        ORDER BY requestId, sortOrder, employeeId`,
      binds, { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    for (const row of (res.rows || []) as any[]) {
      const g = (k: string) => row[k.toUpperCase()] ?? row[k] ?? null;
      const p = out.get(String(g('requestId')));
      if (!p) continue;
      const emp = String(g('employeeId'));
      p.employeeIds.push(emp);
      if (g('status')) p.employeeStatuses[emp] = String(g('status'));
      if (g('expiryDate')) p.individualExpiries[emp] = String(g('expiryDate'));
      if (g('startDate')) p.individualStartDates[emp] = String(g('startDate'));
    }
  }
  return out;
}

// Replace the people fields of mapped applications (objects with an `id`) with the link table's.
export async function attachPeople<T extends { id: string }>(connection: any, apps: T[]): Promise<T[]> {
  if (apps.length === 0) return apps;
  const people = await readPeople(connection, apps.map(a => a.id));
  for (const a of apps) Object.assign(a, people.get(String(a.id)));
  return apps;
}

// Legacy entry point for writers that still keep the people in passRequests' JSON columns: copy
// them into the link table. Called inside the same transaction as the write.
export async function syncRequestEmployees(connection: any, requestId: string): Promise<void> {
  const oracledb = (await import("oracledb")).default;
  const appRes = await connection.execute(
    `SELECT id, employeeIds, employeeStatuses, individualExpiries, individualStartDates FROM passRequests WHERE UPPER(id) = UPPER(:id)`,
    [requestId],
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  const app: any = appRes.rows?.[0];
  if (!app) return;
  const g = (k: string) => app[k.toUpperCase()] ?? app[k] ?? null;
  await writePeople(connection, String(g('id')), {
    employeeIds: parseJson<string[]>(g('employeeIds'), []),
    employeeStatuses: parseJson<Record<string, string>>(g('employeeStatuses'), {}),
    individualExpiries: parseJson<Record<string, string>>(g('individualExpiries'), {}),
    individualStartDates: parseJson<Record<string, string>>(g('individualStartDates'), {}),
  });
}

// Returns the IDs from `ids` that have no employee row. Used to reject new applications that
// name someone who doesn't exist, with a clear message instead of a constraint error.
export async function findMissingEmployees(connection: any, ids: string[]): Promise<string[]> {
  const unique = Array.from(new Set(ids.map(String).filter(Boolean)));
  if (unique.length === 0) return [];
  const oracledb = (await import("oracledb")).default;
  const found = new Set<string>();
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const binds: Record<string, string> = {};
    chunk.forEach((id, j) => { binds[`e${j}`] = id; });
    const res = await connection.execute(
      `SELECT id FROM employees WHERE id IN (${chunk.map((_, j) => `:e${j}`).join(', ')})`,
      binds,
      { outFormat: oracledb.OUT_FORMAT_OBJECT }
    );
    for (const r of (res.rows || []) as any[]) found.add(String(r.ID ?? r.id));
  }
  return unique.filter(id => !found.has(id));
}

// Statuses a person on an application can still be in before any pass is in their hands.
const OPEN_LINE_STATUSES = ['pending', 'under_review', 'review', 'processing', 'under_processing', 'forwarded', 'clarification', 'approved', 'accepted'];

// An employee was deleted: cancel their still-open lines on applications. The application itself
// (employeeStatuses) is the source of truth, so it is updated there, recorded in the application's
// history, and the link table is re-synced from it. An application with nobody left to issue is
// cancelled. Runs inside the caller's transaction.
export async function cancelEmployeesOnApplications(connection: any, employeeIds: string[], actorId: string): Promise<number> {
  const unique = Array.from(new Set(employeeIds.map(String).filter(Boolean)));
  if (unique.length === 0) return 0;
  const oracledb = (await import("oracledb")).default;
  const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const requestIds = new Set<string>();
  for (let i = 0; i < unique.length; i += 500) {
    const chunk = unique.slice(i, i + 500);
    const binds: Record<string, string> = {};
    chunk.forEach((id, j) => { binds[`e${j}`] = id; });
    const res = await connection.execute(
      `SELECT requestId FROM passRequestEmployees WHERE employeeId IN (${chunk.map((_, j) => `:e${j}`).join(', ')})`,
      binds, opts
    );
    for (const r of (res.rows || []) as any[]) requestIds.add(String(r.REQUESTID ?? r.requestId));
  }

  const now = new Date().toISOString();
  const removed = new Set(unique);
  let changedApps = 0;
  for (const requestId of requestIds) {
    const appRes = await connection.execute(
      `SELECT id, status, employeeIds, employeeStatuses FROM passRequests WHERE id = :id AND deletedAt IS NULL`,
      [requestId], opts
    );
    const app: any = appRes.rows?.[0];
    if (!app) continue;
    let empIds: string[] = [];
    let statuses: Record<string, string> = {};
    try { empIds = JSON.parse(app.EMPLOYEEIDS || app.employeeIds || '[]') || []; } catch { empIds = []; }
    try { statuses = JSON.parse(app.EMPLOYEESTATUSES || app.employeeStatuses || '{}') || {}; } catch { statuses = {}; }
    const appStatus = String(app.STATUS || app.status || 'pending').toLowerCase();

    const cancelled: string[] = [];
    for (const empId of empIds) {
      if (!removed.has(String(empId))) continue;
      const current = String(statuses[empId] || appStatus).toLowerCase();
      if (OPEN_LINE_STATUSES.includes(current)) {
        statuses[empId] = 'cancelled';
        cancelled.push(String(empId));
      }
    }
    if (cancelled.length === 0) continue;

    const allClosed = empIds.length > 0 && empIds.every(id => ['cancelled', 'rejected'].includes(String(statuses[id] || appStatus).toLowerCase()));
    const newStatus = allClosed ? 'cancelled' : (app.STATUS || app.status);
    await connection.execute(
      `UPDATE passRequests SET employeeStatuses = :statuses, status = :status, updatedAt = :updatedAt WHERE id = :id`,
      { statuses: JSON.stringify(statuses), status: newStatus, updatedAt: now, id: app.ID || app.id }
    );
    await connection.execute(
      `INSERT INTO requestHistory (id, requestId, userId, action, remarks, timestamp)
       VALUES (:id, :requestId, :userId, 'EMPLOYEE_DELETED', :remarks, :ts)`,
      {
        id: crypto.randomUUID(), requestId: app.ID || app.id, userId: actorId || 'system', ts: now,
        remarks: `Cancelled for deleted employee(s): ${cancelled.join(', ')}${allClosed ? '. Application cancelled: nobody left to issue.' : ''}`
      }
    );
    await syncRequestEmployees(connection, app.ID || app.id);
    changedApps++;
  }
  return changedApps;
}
