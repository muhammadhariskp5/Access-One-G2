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
