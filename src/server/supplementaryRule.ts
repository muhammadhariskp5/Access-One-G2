// --- A supplementary pass is valid only while its person holds a valid main pass in the category ---
// For each valid supplementary pass (of the given people, or everyone): if its main pass is no longer
// valid - ended by any status, past its date, deleted - or it has none, it is re-linked to that
// person's valid main pass in the same category when there is one; otherwise it ends the way its
// main pass ended (revoked -> revoked, replaced -> replaced, otherwise cancelled), with a note.
// Its own expiry date is never changed, and it is never set to 'expired' - expiry comes from dates.
// Runs after a main pass changes status, daily, and once for existing data.
import { normalizeDate } from './dates.ts';
import { businessToday } from './businessDate.ts';
import { logger } from './log.ts';

const LIVE = ['active', 'collected', 'completed', 'received'];
const liveIn = `(${LIVE.map(s => `'${s}'`).join(', ')})`;

export async function settleSupplementaries(conn: any, employeeIds: string[] | null): Promise<{ relinked: number; ended: number }> {
  const oracledb = (await import('oracledb')).default;
  const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const g = (r: any, k: string) => r[k.toUpperCase()] ?? r[k] ?? null;
  const ids = employeeIds ? Array.from(new Set(employeeIds.map(String).filter(Boolean))) : null;
  if (ids && ids.length === 0) return { relinked: 0, ended: 0 };

  const run = async (sql: (inList?: string) => string) => {
    if (!ids) return ((await conn.execute(sql(), {}, opts)).rows || []) as any[];
    const out: any[] = [];
    for (let i = 0; i < ids.length; i += 500) {
      const chunk = ids.slice(i, i + 500);
      const b: Record<string, string> = {};
      chunk.forEach((v, j) => { b[`e${j}`] = v; });
      out.push(...(((await conn.execute(sql(chunk.map((_, j) => `:e${j}`).join(', ')), b, opts)).rows || []) as any[]));
    }
    return out;
  };
  const who = (alias: string, inList?: string) => (inList ? ` AND ${alias}.employeeId IN (${inList})` : '');

  const today = businessToday();
  const alive = (r: any) => { const e = normalizeDate(g(r, 'expiryDate')); return !e || e >= today; };

  // Valid main passes, per person + category (and per site, for sites without a category)
  const mains = (await run(inList => `
    SELECT p.id, p.employeeId, p.locationId, p.expiryDate, l.categoryId
      FROM passes p LEFT JOIN locations l ON l.id = p.locationId
     WHERE p.deletedAt IS NULL AND LOWER(TRIM(COALESCE(p.type, '~'))) = 'main'
       AND LOWER(TRIM(COALESCE(p.status, '~'))) IN ${liveIn}${who('p', inList)}`)).filter(alive);
  const validMainIds = new Set(mains.map(m => String(g(m, 'id'))));
  const mainFor = (emp: string, cat: string | null, loc: string | null) => mains
    .filter(m => String(g(m, 'employeeId')) === emp && (cat ? String(g(m, 'categoryId')) === cat : String(g(m, 'locationId')) === loc))
    .sort((a, b) => String(normalizeDate(g(b, 'expiryDate')) || '9999').localeCompare(String(normalizeDate(g(a, 'expiryDate')) || '9999')))[0];

  // Valid supplementary passes
  const supps = (await run(inList => `
    SELECT s.id, s.employeeId, s.locationId, s.parentPassId, s.passNumber, l.categoryId
      FROM passes s LEFT JOIN locations l ON l.id = s.locationId
     WHERE s.deletedAt IS NULL AND LOWER(TRIM(COALESCE(s.type, '~'))) = 'supplementary'
       AND LOWER(TRIM(COALESCE(s.status, '~'))) IN ${liveIn}${who('s', inList)}`)).filter(alive);

  const now = new Date().toISOString();
  let relinked = 0, ended = 0;
  for (const s of supps) {
    const parent = g(s, 'parentPassId');
    if (parent && validMainIds.has(String(parent))) continue;          // its main pass is valid
    const m = mainFor(String(g(s, 'employeeId')), g(s, 'categoryId') ? String(g(s, 'categoryId')) : null, g(s, 'locationId'));
    if (m) {
      await conn.execute(`UPDATE passes SET parentPassId = :m, updatedAt = :now WHERE id = :id`, { m: g(m, 'id'), now, id: g(s, 'id') });
      relinked++;
    } else {
      // How its main pass ended decides how it ends
      let parentStatus = '';
      if (parent) {
        const pr = ((await conn.execute(`SELECT status FROM passes WHERE id = :id`, { id: parent }, opts)).rows || []) as any[];
        parentStatus = String(g(pr[0] || {}, 'status') || '').trim().toLowerCase();
      }
      const status = parentStatus === 'revoked' ? 'revoked'
        : ['replaced', 'superseded'].includes(parentStatus) ? 'replaced'
        : 'cancelled';
      await conn.execute(
        `UPDATE passes SET status = :status, updatedAt = :now,
                remarks = SUBSTR(COALESCE(remarks, '') || ' [Ended: no valid main pass in this category]', 1, 1000)
          WHERE id = :id`, { status, now, id: g(s, 'id') });
      ended++;
      logger.info('[SupplementaryRule] supplementary ended: no valid main pass in its category', { pass: g(s, 'passNumber') || g(s, 'id') });
    }
  }
  return { relinked, ended };
}
