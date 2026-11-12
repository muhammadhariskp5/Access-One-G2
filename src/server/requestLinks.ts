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
    `SELECT id, status, employeeIds, employeeStatuses FROM passRequests WHERE UPPER(id) = UPPER(:id)`,
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
  const appStatus = app.STATUS || app.status || 'pending';

  // Desired state: one row per employee on the application
  const desired = new Map<string, string>();
  for (const empId of empIds) {
    if (empId) desired.set(String(empId), String(statuses[empId] || appStatus));
  }

  // Current state
  const curRes = await connection.execute(
    `SELECT id, employeeId, status FROM passRequestEmployees WHERE requestId = :id`,
    [realId],
    { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  const seen = new Set<string>();
  for (const row of (curRes.rows || []) as any[]) {
    const rowId = row.ID || row.id;
    const empId = String(row.EMPLOYEEID || row.employeeId || '');
    const status = String(row.STATUS || row.status || '');
    if (!desired.has(empId) || seen.has(empId)) {
      // Person removed from the application (or a duplicate row)
      await connection.execute(`DELETE FROM passRequestEmployees WHERE id = :id`, [rowId]);
      continue;
    }
    seen.add(empId);
    if (status !== desired.get(empId)) {
      await connection.execute(
        `UPDATE passRequestEmployees SET status = :status WHERE id = :id`,
        { status: desired.get(empId), id: rowId }
      );
    }
  }
  for (const [empId, status] of desired) {
    if (seen.has(empId)) continue;
    await connection.execute(
      `INSERT INTO passRequestEmployees (id, requestId, employeeId, status) VALUES (:id, :requestId, :employeeId, :status)`,
      { id: crypto.randomUUID(), requestId: realId, employeeId: empId, status }
    );
  }
}
