// --- The day a pass ended, recorded on the pass (passes.endedOn, YYYY-MM-DD) ---
// A pass's dates are the record, not the time someone last touched it. When a pass ends - any
// ended status (expired, cancelled, revoked, replaced, ...), by any code path or by hand - the
// database stamps endedOn once:
//   - its expiry date, if that has already passed (ended by date)
//   - otherwise today, business calendar (ended early)
// Later edits (remarks, re-saving the form) never move it. A pass put back to a live status has it
// cleared. Readers use COALESCE(endedOn, expiry) as the day the pass ended.
// A trigger does this so no write path can forget it; the daily job stamps any pass the trigger
// missed (e.g. if the trigger could not be created).
import { logger } from './log.ts';
import { ymd } from './passQuery.ts';

export const ENDED_STATUSES = ['expired', 'revoked', 'cancelled', 'replaced', 'superseded', 'inactive', 'rejected', 'deleted'];
const endedIn = `(${ENDED_STATUSES.map(s => `'${s}'`).join(', ')})`;

const ignorable = (e: any) => /ORA-01430|duplicate column|already exists/i.test(String(e?.message));

function triggerSql(engine: string): string[] {
  if (engine === 'oracle') {
    // Business date: Qatar is UTC+3 all year (no daylight saving)
    return [`CREATE OR REPLACE TRIGGER trg_pass_ended BEFORE INSERT OR UPDATE OF status ON passes FOR EACH ROW
DECLARE
  v_today VARCHAR2(10);
  v_exp   VARCHAR2(10);
BEGIN
  IF LOWER(TRIM(:NEW.status)) IN ${endedIn} THEN
    IF :NEW.endedOn IS NULL THEN
      v_today := TO_CHAR(SYS_EXTRACT_UTC(SYSTIMESTAMP) + INTERVAL '3' HOUR, 'YYYY-MM-DD');
      v_exp := SUBSTR(TRIM(:NEW.expiryDate), 1, 10);
      IF REGEXP_LIKE(v_exp, '^[0-9]{4}-[0-9]{2}-[0-9]{2}$') AND v_exp < v_today THEN
        :NEW.endedOn := v_exp;
      ELSE
        :NEW.endedOn := v_today;
      END IF;
    END IF;
  ELSE
    :NEW.endedOn := NULL;
  END IF;
END;`];
  }
  const today = `date('now', '+3 hours')`;
  const exp = `substr(trim(NEW.expiryDate), 1, 10)`;
  const value = `CASE WHEN ${exp} GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]' AND ${exp} < ${today} THEN ${exp} ELSE ${today} END`;
  const ended = `lower(trim(NEW.status)) IN ${endedIn}`;
  return [
    `CREATE TRIGGER IF NOT EXISTS trg_pass_ended_i AFTER INSERT ON passes FOR EACH ROW WHEN ${ended} AND NEW.endedOn IS NULL
     BEGIN UPDATE passes SET endedOn = ${value} WHERE rowid = NEW.rowid; END`,
    `CREATE TRIGGER IF NOT EXISTS trg_pass_ended_u AFTER UPDATE OF status ON passes FOR EACH ROW WHEN ${ended} AND NEW.endedOn IS NULL
     BEGIN UPDATE passes SET endedOn = ${value} WHERE rowid = NEW.rowid; END`,
    `CREATE TRIGGER IF NOT EXISTS trg_pass_live_u AFTER UPDATE OF status ON passes FOR EACH ROW WHEN NOT (${ended}) AND NEW.endedOn IS NOT NULL
     BEGIN UPDATE passes SET endedOn = NULL WHERE rowid = NEW.rowid; END`,
  ];
}

// Migration: column, trigger, and the end day of passes that ended before it existed. For those
// the only record is when the pass was last changed (once, now) - or its expiry if that came first.
export async function installPassEnd(conn: any, engine: string, today: string): Promise<number> {
  try { await conn.execute(`ALTER TABLE passes ADD (endedOn VARCHAR2(10))`); } catch (e) { if (!ignorable(e)) throw e; }
  const exp = ymd('expiryDate');
  const upd = ymd('updatedAt');
  const r = await conn.execute(
    `UPDATE passes SET endedOn = CASE
        WHEN ${exp} IS NOT NULL AND (${upd} IS NULL OR ${exp} < ${upd}) AND ${exp} <= :today THEN ${exp}
        WHEN ${upd} IS NOT NULL THEN ${upd}
        ELSE :today END
      WHERE endedOn IS NULL AND LOWER(TRIM(COALESCE(status, '~'))) IN ${endedIn}`,
    { today });
  await installTrigger(conn, engine);
  return r?.rowsAffected || 0;
}

export async function installTrigger(conn: any, engine: string): Promise<void> {
  for (const sql of triggerSql(engine)) {
    try { await conn.execute(sql); } catch (e: any) {
      logger.error('[PassEnd] could not create the pass-ended trigger; the daily job will stamp end dates instead', { err: String(e?.message || e) });
    }
  }
  if (engine === 'oracle') {
    // An invalid trigger makes every write to passes fail: never leave one behind
    const oracledb = (await import('oracledb')).default;
    const res = await conn.execute(`SELECT status FROM user_objects WHERE object_type = 'TRIGGER' AND object_name = 'TRG_PASS_ENDED'`,
      {}, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    const status = String(((res.rows || [])[0] as any)?.STATUS ?? '');
    if (status && status !== 'VALID') {
      logger.error('[PassEnd] pass-ended trigger did not compile; removed it (the daily job will stamp end dates)', { status });
      await conn.execute(`DROP TRIGGER trg_pass_ended`);
    }
  }
}

// Safety net (daily job): any ended pass without an end day gets one - its expiry if passed, else today
export async function stampMissingEndDates(conn: any, today: string): Promise<number> {
  const exp = ymd('expiryDate');
  const r = await conn.execute(
    `UPDATE passes SET endedOn = CASE WHEN ${exp} IS NOT NULL AND ${exp} < :today THEN ${exp} ELSE :today END
      WHERE endedOn IS NULL AND LOWER(TRIM(COALESCE(status, '~'))) IN ${endedIn}`,
    { today });
  return r?.rowsAffected || 0;
}

// SQL for "the day this pass ended or ends" (alias p): recorded end day, else its expiry
export const passEndSql = (alias = 'p') => `COALESCE(${ymd(`${alias}.endedOn`)}, ${ymd(`COALESCE(${alias}.expiryDate, ${alias}.endDate)`)})`;
