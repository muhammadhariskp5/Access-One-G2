import express from "express";
import { logger } from "../log.ts";
import { ymd } from "../passQuery.ts";
import { pageClause } from "../employeeQuery.ts";
import { businessToday, addDays } from "../businessDate.ts";
import type { RouteContext } from "../context.ts";

// --- Access Matrix: who appears, searched, sorted and paged by the database ---
// The same rules the screen applied to the full lists (AccessMatrix.tsx), as SQL over each
// person's live passes:
//   valid    - status active/collected/completed/received, not replaced, not expired
//   expired  - status 'expired' or expiry date before today
//   replaced - status replaced/superseded, or remarks mention "replaced"
//   recent   - expired within the user's window (Settings > Display), not replaced/revoked/cancelled
//   in range - the date-range filter (isPassInDateRange)
// Each row comes with all of that person's live passes; the screen builds its cells from them as
// before. GET /api/matrix?page=&pageSize=&q=&status=&category=&from=&to=&sort=&order=&expiredDays=
// or &all=1 (export / print). Returns { items: [employee + passes], total, page, pageSize }.

const PAGE_MAX = 200;
const EXPORT_MAX = 20000;
const SORTS: Record<string, string> = {
  name: 'e.name', code: 'e.employeeId', jobTitle: 'e.jobTitle', dept: 'e.department',
  division: 'e.division', qid: 'COALESCE(e.qatarId, e.qidVisaNumber)', status: 'e.status',
};
const STATUSES = ['active', 'all', 'expired', 'replaced', 'no_valid_pass', 'all_records'];

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const dateParam = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : null);

export function registerMatrixRoutes(app: express.Express, ctx: RouteContext) {
  const { oracledb, authorize, getConnection, getTenantOrgId, toCamelCase, getDbEngine } = ctx;

  app.get("/api/matrix", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      const q = str(req.query.q).slice(0, 200).toLowerCase();
      const status = STATUSES.includes(str(req.query.status)) ? str(req.query.status) : 'active';
      const category = str(req.query.category);
      const from = dateParam(req.query.from);
      const to = dateParam(req.query.to);
      const sort = SORTS[str(req.query.sort)] ? str(req.query.sort) : 'name';
      const order = str(req.query.order) === 'desc' ? 'DESC' : 'ASC';
      const all = str(req.query.all) === '1';
      const page = Math.max(1, parseInt(str(req.query.page), 10) || 1);
      const pageSize = Math.min(PAGE_MAX, Math.max(1, parseInt(str(req.query.pageSize), 10) || 50));
      const expiredDays = Math.max(0, Math.min(3650, parseInt(str(req.query.expiredDays), 10) || 0));

      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
      const today = businessToday();
      const binds: Record<string, unknown> = { today };
      if (orgId) binds.orgId = orgId;

      // Per-pass rules (alias p)
      const st = `LOWER(COALESCE(p.status, ''))`;
      const exp = ymd('p.expiryDate');
      const REPL = `(${st} IN ('replaced', 'superseded') OR LOWER(COALESCE(p.remarks, '')) LIKE '%replaced%')`;
      const EXPIRED = `(${st} = 'expired' OR (${exp} IS NOT NULL AND ${exp} < :today))`;
      const VALID = `(${st} IN ('active', 'collected', 'completed', 'received') AND NOT ${REPL} AND NOT ${EXPIRED})`;
      const EXPSET = `(${EXPIRED} AND NOT ${REPL} AND ${st} NOT IN ('rejected', 'cancelled'))`;
      const showsRecent = (status === 'active' || status === 'all') && expiredDays > 0;
      if (showsRecent) binds.cutoff = addDays(today, -expiredDays);
      const RECENT = showsRecent
        ? `(${EXPIRED} AND NOT ${REPL} AND ${st} NOT IN ('revoked', 'cancelled', 'rejected', 'draft')
            AND COALESCE(${exp}, ${ymd('p.updatedAt')}) >= :cutoff)`
        : `(1 = 0)`;
      let IN_RANGE = '1 = 1';
      if (from) { binds.dFrom = from; IN_RANGE += ` AND NOT (${ymd('COALESCE(p.expiryDate, p.endDate)')} IS NOT NULL AND ${ymd('COALESCE(p.expiryDate, p.endDate)')} < :dFrom)`; }
      if (to) {
        binds.dTo = to;
        IN_RANGE += ` AND COALESCE(${ymd('COALESCE(p.startDate, p.createdAt)')}, '1970-01-01') <= :dTo`;
        IN_RANGE += ` AND NOT (${ymd('COALESCE(p.expiryDate, p.endDate)')} IS NOT NULL AND ${ymd('COALESCE(p.expiryDate, p.endDate)')} > :dTo)`;
      }
      const passOf = (extraFrom = '') => `FROM passes p${extraFrom} WHERE p.employeeId = e.id AND p.deletedAt IS NULL AND ${IN_RANGE}`;
      const has = (rule: string) => `EXISTS (SELECT 1 ${passOf()} AND ${rule})`;
      const hasValidOrRecent = `(${has(VALID)} OR ${has(RECENT)})`;

      // Which people appear (status filter)
      const where: string[] = ['e.deletedAt IS NULL'];
      if (orgId) where.push('e.organizationId = :orgId');
      if (status === 'active' || status === 'all') where.push(hasValidOrRecent);
      else if (status === 'expired') where.push(has(EXPSET));
      else if (status === 'replaced') where.push(has(REPL));
      else if (status === 'no_valid_pass') where.push(`NOT ${has(VALID)}`);
      else if (status === 'all_records') where.push(has('1 = 1'));

      // The passes that count for search and category
      const RELEVANT = status === 'expired' ? EXPSET
        : status === 'replaced' ? REPL
        : `((${hasValidOrRecent} AND (${VALID} OR ${RECENT})) OR NOT ${hasValidOrRecent})`;

      if (q) {
        binds.q = `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`;
        const like = (c: string) => `LOWER(${c}) LIKE :q ESCAPE '\\'`;
        where.push(`(${['e.name', 'e.employeeId', 'e.jobTitle', 'e.qatarId', 'e.qidVisaNumber', 'e.department', 'e.division'].map(like).join(' OR ')}
          OR EXISTS (SELECT 1 ${passOf(' LEFT JOIN locations ql ON ql.id = p.locationId')} AND ${RELEVANT}
                     AND (${like('ql.name')} OR ${like('p.accessCodes')})))`);
      }
      if (category && category !== 'all') {
        binds.category = category;
        where.push(`EXISTS (SELECT 1 ${passOf(' JOIN locations cl ON cl.id = p.locationId')} AND ${RELEVANT} AND cl.categoryId = :category)`);
      }

      const whereSql = where.join(' AND ');
      const countRes = await connection.execute(`SELECT COUNT(*) AS cnt FROM employees e WHERE ${whereSql}`, binds, opts);
      const total = Number((countRes.rows?.[0] as any)?.CNT ?? (countRes.rows?.[0] as any)?.cnt ?? 0);
      const limit = all ? EXPORT_MAX : pageSize;
      const offset = all ? 0 : (page - 1) * pageSize;
      const dir = order;
      const empRes = await connection.execute(
        `SELECT e.* FROM employees e WHERE ${whereSql}
          ORDER BY ${SORTS[sort]} ${dir} ${dir === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST'}, e.id ASC
          ${pageClause(getDbEngine(), offset, limit)}`,
        binds, opts
      );
      const employees: any[] = ((empRes.rows || []) as any[]).map(r => toCamelCase(r));

      // All live passes of the people on this page (the screen builds the cells from them)
      const byEmp = new Map<string, any[]>(employees.map(e => [String(e.id), []]));
      const ids = Array.from(byEmp.keys());
      for (let i = 0; i < ids.length; i += 500) {
        const chunk = ids.slice(i, i + 500);
        const pb: Record<string, unknown> = {};
        chunk.forEach((id, j) => { pb[`e${j}`] = id; });
        const pr = await connection.execute(
          `SELECT * FROM passes WHERE deletedAt IS NULL AND employeeId IN (${chunk.map((_, j) => `:e${j}`).join(', ')})`,
          pb, opts
        );
        for (const p of (pr.rows || []) as any[]) {
          const mapped = { ...toCamelCase(p), accessCodes: (() => { try { return JSON.parse(p.ACCESSCODES || p.accessCodes || '[]'); } catch { return []; } })(), authorityAppNumber: p.AUTHORITYAPPNUMBER ?? p.authorityAppNumber ?? null };
          byEmp.get(String(mapped.employeeId))?.push(mapped);
        }
      }

      res.json({
        items: employees.map(e => ({ ...e, passes: byEmp.get(String(e.id)) || [] })),
        total, page: all ? 1 : page, pageSize: limit,
      });
    } catch (err) {
      logger.error('Error building access matrix', { err });
      res.status(500).json({ error: "Failed to load access matrix" });
    } finally {
      if (connection) await connection.close();
    }
  });
}
