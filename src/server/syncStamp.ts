// --- Delta sync for the big lists (employees, passes, applications) ---
// After a change the browser asks only for rows changed since its last fetch, instead of
// downloading the whole list again. "Changed" is recorded by the database itself: a trigger
// stamps syncAt on every insert or update of these tables, whatever code did the write (soft
// deletes are updates, so deletions are seen too). If the triggers aren't in place (e.g. missing
// privilege), delta mode is off and the browser falls back to full downloads — never stale data.
import { logger } from './log.ts';

export const SYNC_TABLES = ['employees', 'passes', 'passRequests'] as const;

// Re-read a window before the cursor: covers a write whose transaction commits a little after
// its stamp, and clock differences between the app server and the database.
const OVERLAP_MS = 5 * 60 * 1000;

let ready = false;
export const isSyncReady = () => ready;

const ignorable = (e: any) => /ORA-00955|ORA-01408|ORA-01430|already exists|duplicate column/i.test(String(e?.message));

function triggerSql(engine: string, table: string): string[] {
  if (engine === 'oracle') {
    return [`CREATE OR REPLACE TRIGGER trg_sync_${table} BEFORE INSERT OR UPDATE ON ${table} FOR EACH ROW
BEGIN
  :NEW.syncAt := TO_CHAR(SYS_EXTRACT_UTC(SYSTIMESTAMP), 'YYYY-MM-DD"T"HH24:MI:SS.FF3"Z"');
END;`];
  }
  const stamp = `strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`;
  return [
    `CREATE TRIGGER IF NOT EXISTS trg_sync_${table}_i AFTER INSERT ON ${table} FOR EACH ROW
     BEGIN UPDATE ${table} SET syncAt = ${stamp} WHERE rowid = NEW.rowid; END`,
    `CREATE TRIGGER IF NOT EXISTS trg_sync_${table}_u AFTER UPDATE ON ${table} FOR EACH ROW WHEN NEW.syncAt IS OLD.syncAt
     BEGIN UPDATE ${table} SET syncAt = ${stamp} WHERE rowid = NEW.rowid; END`,
  ];
}

// Migration: column, backfill, index, triggers. A trigger that can't be created is logged and
// leaves delta mode off rather than failing startup.
export async function installSyncStamps(conn: any, engine: string): Promise<void> {
  const now = new Date().toISOString();
  for (const t of SYNC_TABLES) {
    try { await conn.execute(`ALTER TABLE ${t} ADD (syncAt VARCHAR2(30))`); } catch (e) { if (!ignorable(e)) throw e; }
    await conn.execute(`UPDATE ${t} SET syncAt = :now WHERE syncAt IS NULL`, { now });
    try { await conn.execute(`CREATE INDEX idx_${t}_sync ON ${t} (syncAt)`); } catch (e) { if (!ignorable(e)) throw e; }
    for (const sql of triggerSql(engine, t)) {
      try { await conn.execute(sql); } catch (e: any) {
        logger.warn('[Sync] could not create change trigger; lists will be downloaded in full', { table: t, err: String(e?.message || e) });
      }
    }
    if (engine === 'oracle') await dropIfInvalid(conn, `TRG_SYNC_${t.toUpperCase()}`);
  }
}

// Oracle keeps a trigger that failed to compile, and an invalid trigger makes every write to its
// table fail. Never leave one behind.
async function dropIfInvalid(conn: any, name: string): Promise<void> {
  const oracledb = (await import('oracledb')).default;
  const res = await conn.execute(
    `SELECT status FROM user_objects WHERE object_type = 'TRIGGER' AND object_name = :name`,
    { name }, { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  const status = String(((res.rows || [])[0] as any)?.STATUS ?? '');
  if (status && status !== 'VALID') {
    logger.error('[Sync] change trigger did not compile; removed it (lists will be downloaded in full)', { trigger: name, status });
    await conn.execute(`DROP TRIGGER ${name}`);
  }
}

// At startup: delta mode only when every table's trigger exists and is enabled.
export async function checkSyncStamps(conn: any, engine: string): Promise<boolean> {
  const oracledb = (await import('oracledb')).default;
  const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  try {
    const sql = engine === 'oracle'
      ? `SELECT LOWER(t.trigger_name) AS name FROM user_triggers t
           JOIN user_objects o ON o.object_name = t.trigger_name AND o.object_type = 'TRIGGER'
          WHERE t.status = 'ENABLED' AND o.status = 'VALID' AND LOWER(t.trigger_name) LIKE 'trg_sync_%'`
      : `SELECT LOWER(name) AS name FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'trg_sync_%'`;
    const res = await conn.execute(sql, {}, opts);
    const names = new Set(((res.rows || []) as any[]).map(r => String(r.NAME ?? r.name)));
    const want = SYNC_TABLES.flatMap(t => engine === 'oracle' ? [`trg_sync_${t.toLowerCase()}`] : [`trg_sync_${t.toLowerCase()}_i`, `trg_sync_${t.toLowerCase()}_u`]);
    ready = want.every(n => names.has(n));
  } catch (e: any) {
    ready = false;
    logger.warn('[Sync] could not check change triggers', { err: String(e?.message || e) });
  }
  logger.info(`[Sync] delta list refresh ${ready ? 'enabled' : 'disabled (full downloads)'}`);
  return ready;
}

// Cursor handed to the browser: taken before the list is read, so anything written meanwhile
// is picked up next time.
export const syncCursor = () => new Date().toISOString();

// ?since=<cursor> -> the stamp to read from (with the overlap), or null if malformed.
export function sinceFromCursor(v: unknown): string | null {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/.test(v)) return null;
  const t = Date.parse(v);
  return Number.isNaN(t) ? null : new Date(t - OVERLAP_MS).toISOString();
}

// Shared handler body for the three list routes.
// Full list: sets X-Sync-Cursor. Delta (?since=): { items, removed, cursor }.
export async function respondDelta(
  req: any, res: any, connection: any, table: string, orgId: string | null,
  mapRow: (row: any) => any,
): Promise<boolean> {
  if (req.query.since === undefined) {
    if (ready) res.setHeader('X-Sync-Cursor', syncCursor());
    return false;
  }
  if (!ready) { res.status(409).json({ error: 'Delta refresh unavailable' }); return true; }
  const since = sinceFromCursor(req.query.since);
  if (!since) { res.status(400).json({ error: 'Invalid since' }); return true; }
  const cursor = syncCursor();
  const oracledb = (await import('oracledb')).default;
  const binds: Record<string, unknown> = { since };
  let sql = `SELECT * FROM ${table} WHERE syncAt >= :since`;
  if (orgId) { sql += ` AND organizationId = :orgId`; binds.orgId = orgId; }
  const result = await connection.execute(sql, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  const items: any[] = [];
  const removed: string[] = [];
  for (const r of (result.rows || []) as any[]) {
    if ((r.DELETEDAT ?? r.deletedAt) != null) removed.push(String(r.ID ?? r.id));
    else items.push(mapRow(r));
  }
  res.json({ items, removed, cursor });
  return true;
}
