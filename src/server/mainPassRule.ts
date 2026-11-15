// --- One valid main pass per person per category ---
// A person may hold at most one valid main pass in a category (valid = active / collected /
// completed / received and not past its expiry date). When an activation would leave two, the one
// valid longest is kept (normally the renewal) and the others are marked 'replaced' - kept as
// history, with a note. Supplementary passes hanging off a replaced pass move to the kept one, so
// no valid supplementary is lost. Runs inside the caller's transaction after any write that can
// activate a main pass, and daily over everyone as a safety net.
import { normalizeDate } from './dates.ts';
import { businessToday } from './businessDate.ts';
import { logger } from './log.ts';

const LIVE = ['active', 'collected', 'completed', 'received'];

export async function enforceOneMainPassPerCategory(
  conn: any,
  employeeIds: string[] | null,                       // null = everyone
  onEnded?: (requestIds: string[]) => Promise<unknown>, // close the replaced passes' application lines
  reportOnly = false,                                 // true: only log, change nothing
): Promise<{ groups: number; replaced: number }> {
  const oracledb = (await import('oracledb')).default;
  const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const g = (r: any, k: string) => r[k.toUpperCase()] ?? r[k] ?? null;
  const ids = employeeIds ? Array.from(new Set(employeeIds.map(String).filter(Boolean))) : null;
  if (ids && ids.length === 0) return { groups: 0, replaced: 0 };

  const sql = (inList?: string) => `
    SELECT p.id, p.employeeId, p.requestId, p.passNumber, p.expiryDate, p.createdAt, l.categoryId
      FROM passes p JOIN locations l ON l.id = p.locationId
     WHERE p.deletedAt IS NULL AND LOWER(TRIM(COALESCE(p.type, '~'))) = 'main'
       AND LOWER(TRIM(COALESCE(p.status, '~'))) IN (${LIVE.map(s => `'${s}'`).join(', ')})
       AND l.categoryId IS NOT NULL${inList ? ` AND p.employeeId IN (${inList})` : ''}`;
  const rows: any[] = [];
  if (ids) {
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const binds: Record<string, string> = {};
      chunk.forEach((v, j) => { binds[`e${j}`] = v; });
      rows.push(...(((await conn.execute(sql(chunk.map((_, j) => `:e${j}`).join(', ')), binds, opts)).rows || []) as any[]));
    }
  } else {
    rows.push(...(((await conn.execute(sql(), {}, opts)).rows || []) as any[]));
  }

  // Valid ones, grouped by person + category
  const today = businessToday();
  const groups = new Map<string, any[]>();
  for (const r of rows) {
    const exp = normalizeDate(g(r, 'expiryDate'));
    if (exp && exp < today) continue;                     // already past its date
    const key = `${g(r, 'employeeId')}|${g(r, 'categoryId')}`;
    const list = groups.get(key) || [];
    list.push({ id: String(g(r, 'id')), requestId: g(r, 'requestId'), passNumber: g(r, 'passNumber'), exp: exp || '9999-12-31', created: String(g(r, 'createdAt') || '') });
    groups.set(key, list);
  }

  let groupCount = 0, replaced = 0;
  const endedRequests: string[] = [];
  const now = new Date().toISOString();
  for (const [key, list] of groups) {
    if (list.length < 2) continue;
    groupCount++;
    if (reportOnly) {
      logger.warn('[MainPassRule] person holds several valid main passes in one category - cancel the wrong one', { key, passes: list.map(d => d.passNumber || d.id) });
      continue;
    }
    // Keep the one valid longest; on a tie, the newest
    list.sort((a, b) => b.exp.localeCompare(a.exp) || b.created.localeCompare(a.created));
    const keep = list[0];
    for (const dup of list.slice(1)) {
      await conn.execute(
        `UPDATE passes SET status = 'replaced', updatedAt = :now,
                remarks = SUBSTR(COALESCE(remarks, '') || ' [Replaced: only one valid main pass per category - kept ' || :keep || ']', 1, 1000)
          WHERE id = :id`,
        { now, keep: String(keep.passNumber || keep.id), id: dup.id }
      );
      await conn.execute(
        `UPDATE passes SET parentPassId = :keep, updatedAt = :now WHERE parentPassId = :dup AND deletedAt IS NULL`,
        { keep: keep.id, dup: dup.id, now }
      );
      if (dup.requestId) endedRequests.push(String(dup.requestId));
      replaced++;
    }
    logger.warn('[MainPassRule] person had several valid main passes in one category; kept one', { key, kept: keep.id, replaced: list.slice(1).map(d => d.id) });
  }
  if (onEnded && endedRequests.length) await onEnded(Array.from(new Set(endedRequests)));
  return { groups: groupCount, replaced };
}

// --- Refuse a second main pass (checked BEFORE anything is written) ---
// While someone holds a valid main pass in a category, another main pass in that category is
// refused until the first is cancelled or expires. Exception: renewal - when the current one ends
// within RENEWAL_DAYS, a new one may be applied for / issued; once it is collected the old one is
// retired. Returns the refusal message, or null when allowed.
export const RENEWAL_DAYS = 45;

export async function mainPassConflict(
  conn: any,
  employeeId: string,
  locationId: string | null | undefined,
  opts: { excludeRequestId?: string | null; excludePassId?: string | null } = {},
): Promise<string | null> {
  if (!employeeId || !locationId) return null;
  const oracledb = (await import('oracledb')).default;
  const o = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const g = (r: any, k: string) => r?.[k.toUpperCase()] ?? r?.[k] ?? null;
  const loc = ((await conn.execute(`SELECT categoryId FROM locations WHERE id = :id`, { id: locationId }, o)).rows || [])[0];
  const categoryId = g(loc, 'categoryId');
  const binds: Record<string, unknown> = { emp: employeeId };
  let where = `p.employeeId = :emp AND p.deletedAt IS NULL AND LOWER(TRIM(COALESCE(p.type, '~'))) = 'main'
               AND LOWER(TRIM(COALESCE(p.status, '~'))) IN (${LIVE.map(s => `'${s}'`).join(', ')})`;
  if (categoryId) { where += ` AND l.categoryId = :cat`; binds.cat = categoryId; }
  else { where += ` AND p.locationId = :loc`; binds.loc = locationId; }
  if (opts.excludeRequestId) { where += ` AND (p.requestId IS NULL OR p.requestId <> :rid)`; binds.rid = opts.excludeRequestId; }
  if (opts.excludePassId) { where += ` AND p.id <> :pid`; binds.pid = opts.excludePassId; }
  const rows = ((await conn.execute(
    `SELECT p.id, p.passNumber, p.expiryDate, l.name AS locationName, e.name AS employeeName
       FROM passes p LEFT JOIN locations l ON l.id = p.locationId LEFT JOIN employees e ON e.id = p.employeeId
      WHERE ${where}`, binds, o)).rows || []) as any[];
  const today = businessToday();
  const renewFrom = (exp: string) => {
    const d = new Date(`${exp}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - RENEWAL_DAYS);
    return d.toISOString().slice(0, 10);
  };
  const dmy = (d: string) => `${d.slice(8, 10)}-${d.slice(5, 7)}-${d.slice(0, 4)}`;
  for (const r of rows) {
    const exp = normalizeDate(g(r, 'expiryDate'));
    if (exp && exp < today) continue;                     // already past its date
    if (exp && renewFrom(exp) <= today) continue;         // renewal window: allowed
    const who = g(r, 'employeeName') || 'This person';
    return `${who} already holds a valid main pass in this category (${g(r, 'passNumber') || g(r, 'id')} at ${g(r, 'locationName') || 'another site'}${exp ? `, valid to ${dmy(exp)}` : ''}). ` +
      `A second main pass is not allowed: cancel that pass first${exp ? `, or renew from ${dmy(renewFrom(exp))} (${RENEWAL_DAYS} days before it expires)` : ''}.`;
  }
  return null;
}

// A supplementary pass is a child of a main pass: it can only be collected or made active while
// the person holds a valid main pass (live status, not past its date) in the same category (the
// same site when the site has no category). Returns the reason to refuse, or null.
export async function supplementaryParentMissing(
  conn: any,
  employeeId: string,
  locationId: string | null | undefined,
  treatAsLive: string[] = [],          // main passes being made active in the same action
): Promise<string | null> {
  if (!employeeId || !locationId) return null;
  const oracledb = (await import('oracledb')).default;
  const o = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const g = (r: any, k: string) => r?.[k.toUpperCase()] ?? r?.[k] ?? null;
  const loc = ((await conn.execute(
    `SELECT l.categoryId, l.name AS locationName, c.name AS categoryName FROM locations l LEFT JOIN categories c ON c.id = l.categoryId WHERE l.id = :id`,
    { id: locationId }, o)).rows || [])[0];
  const categoryId = g(loc, 'categoryId');
  const binds: Record<string, unknown> = { emp: employeeId };
  const alsoLive = treatAsLive.slice(0, 500);
  alsoLive.forEach((id, i) => { binds[`t${i}`] = id; });
  const liveStatus = `LOWER(TRIM(COALESCE(p.status, '~'))) IN (${LIVE.map(s => `'${s}'`).join(', ')})`;
  let where = `p.employeeId = :emp AND p.deletedAt IS NULL AND LOWER(TRIM(COALESCE(p.type, '~'))) = 'main'
               AND (${liveStatus}${alsoLive.length ? ` OR p.id IN (${alsoLive.map((_, i) => `:t${i}`).join(', ')})` : ''})`;
  if (categoryId) { where += ` AND l.categoryId = :cat`; binds.cat = categoryId; }
  else { where += ` AND p.locationId = :loc`; binds.loc = locationId; }
  const rows = ((await conn.execute(
    `SELECT p.expiryDate FROM passes p LEFT JOIN locations l ON l.id = p.locationId WHERE ${where}`, binds, o)).rows || []) as any[];
  const today = businessToday();
  if (rows.some(r => { const exp = normalizeDate(g(r, 'expiryDate')); return !exp || exp >= today; })) return null;
  const emp = ((await conn.execute(`SELECT name FROM employees WHERE id = :id`, { id: employeeId }, o)).rows || [])[0];
  const who = g(emp, 'name') || 'This person';
  const where2 = categoryId ? `the ${g(loc, 'categoryName') || 'same'} category` : (g(loc, 'locationName') || 'this site');
  return `${who} has no valid main pass in ${where2}. A supplementary pass belongs to a main pass: ` +
    `it can only be applied for, collected or activated while the person holds a valid main pass there.`;
}
