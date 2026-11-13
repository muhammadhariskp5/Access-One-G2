import crypto from 'crypto';

// --- passRequestEmployees mapping-table sync ---
// The employee detail page and search read this table; it must always mirror
// passRequests.employeeIds / employeeStatuses. Called inside the same transaction as the write
// that changed the application, so both commit (or roll back) together.
// Incremental: inserts people added, deletes people removed, updates changed statuses —
// unchanged rows are left alone.
export async function syncRequestEmployees(connection: any, requestId: string): Promise<void> {
  const oracledb = (await import("oracledb")).default;
  const appRes = await connection.execute(
    `SELECT id, status, employeeIds, employeeStatuses, individualExpiries FROM passRequests WHERE UPPER(id) = UPPER(:id)`,
    [requestId],
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  const app: any = appRes.rows?.[0];
  if (!app) return;
  const realId = app.ID || app.id;
  let empIds: string[] = [];
  let statuses: Record<string, string> = {};
  try { empIds = JSON.parse(app.EMPLOYEEIDS || app.employeeIds || '[]') || []; } catch { empIds = []; }
  try { statuses = JSON.parse(app.EMPLOYEESTATUSES || app.employeeStatuses || '{}') || {}; } catch { statuses = {}; }
  let expiries: Record<string, string> = {};
  try { expiries = JSON.parse(app.INDIVIDUALEXPIRIES || app.individualExpiries || '{}') || {}; } catch { expiries = {}; }
  const appStatus = app.STATUS || app.status || 'pending';

  // Desired state: one row per employee on the application, with that person's status and
  // own expiry date (null = the application's end date applies)
  const desired = new Map<string, { status: string; expiry: string | null }>();
  for (const empId of empIds) {
    if (empId) desired.set(String(empId), {
      status: String(statuses[empId] || appStatus),
      expiry: expiries[empId] ? String(expiries[empId]).slice(0, 50) : null,
    });
  }

  // Current state
  const curRes = await connection.execute(
    `SELECT id, employeeId, status, expiryDate FROM passRequestEmployees WHERE requestId = :id`,
    [realId],
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  const seen = new Set<string>();
  for (const row of (curRes.rows || []) as any[]) {
    const rowId = row.ID || row.id;
    const empId = String(row.EMPLOYEEID || row.employeeId || '');
    const status = String(row.STATUS || row.status || '');
    const expiry = (row.EXPIRYDATE ?? row.expiryDate) || null;
    const want = desired.get(empId);
    if (!want || seen.has(empId)) {
      // Person removed from the application (or a duplicate row)
      await connection.execute(`DELETE FROM passRequestEmployees WHERE id = :id`, [rowId]);
      continue;
    }
    seen.add(empId);
    if (status !== want.status || expiry !== want.expiry) {
      await connection.execute(
        `UPDATE passRequestEmployees SET status = :status, expiryDate = :expiryDate WHERE id = :id`,
        { status: want.status, expiryDate: want.expiry, id: rowId }
      );
    }
  }
  for (const [empId, want] of desired) {
    if (seen.has(empId)) continue;
    // Insert only when the employee row exists: a stale ID in an old application's JSON must not
    // create a dangling link (or, with foreign keys enforced, make every edit of it fail).
    await connection.execute(
      `INSERT INTO passRequestEmployees (id, requestId, employeeId, status, expiryDate)
       SELECT :id, :requestId, e.id, :status, :expiryDate FROM employees e WHERE e.id = :employeeId`,
      { id: crypto.randomUUID(), requestId: realId, employeeId: empId, status: want.status, expiryDate: want.expiry }
    );
  }
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
