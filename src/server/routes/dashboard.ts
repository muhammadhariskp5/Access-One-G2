import express from "express";
import { logger } from "../log.ts";
import { ymd } from "../passQuery.ts";
import { businessToday, addDays } from "../businessDate.ts";
import type { RouteContext } from "../context.ts";

// --- Dashboard summary ---
// Everything the dashboard shows, computed by the database in one request (counts, the short
// lists, per-location totals), so the browser doesn't need the full employee/pass/application lists.

// Passes counted as active on the dashboard
const ACTIVE_PASS = ['active', 'collected', 'completed', 'approved'];
// Applications no longer in progress (completed + history statuses, as utils/passStatus.ts)
const CLOSED_APP = ['completed', 'expired', 'replaced', 'superseded', 'revoked', 'cancelled', 'rejected', 'archived', 'inactive', 'deleted'];
const LIST_CAP = 200;
const inList = (xs: string[]) => xs.map(s => `'${s}'`).join(', ');

export function registerDashboardRoutes(app: express.Express, ctx: RouteContext) {
  const { oracledb, authorize, getConnection, getTenantOrgId, getDbEngine } = ctx;

  app.get("/api/dashboard", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
      const engine = getDbEngine();
      const cap = (n: number) => `FETCH FIRST ${n} ROWS ONLY`;
      const org = (alias: string) => (orgId ? ` AND ${alias}.organizationId = :orgId` : '');
      const ob: Record<string, unknown> = orgId ? { orgId } : {};
      const rows = async (sql: string, binds: Record<string, unknown> = {}) =>
        ((await connection.execute(sql, { ...ob, ...binds }, opts)).rows || []) as any[];
      const v = (r: any, k: string) => r?.[k.toUpperCase()] ?? r?.[k];
      const num = (r: any, k: string) => Number(v(r, k) ?? 0);

      const today = businessToday();
      const in2 = addDays(today, 2);
      const in30 = addDays(today, 30);
      const exp = ymd('p.expiryDate');
      const activePass = `LOWER(p.status) IN (${inList(ACTIVE_PASS)})`;
      const openApp = `LOWER(COALESCE(r.status, '')) NOT IN (${inList(CLOSED_APP)})`;

      // Counts
      const [counts] = await rows(`
        SELECT (SELECT COUNT(*) FROM employees e WHERE e.deletedAt IS NULL${org('e')}) AS employeeCount,
               (SELECT COUNT(*) FROM passes p WHERE p.deletedAt IS NULL${org('p')}) AS totalPassCount,
               (SELECT COUNT(*) FROM passes p WHERE p.deletedAt IS NULL AND ${activePass}${org('p')}) AS activePassCount,
               (SELECT COUNT(*) FROM passRequests r WHERE r.deletedAt IS NULL AND ${openApp}${org('r')}) AS activeApplicationCount
          FROM ${engine === 'oracle' ? 'dual' : '(SELECT 1 AS one) d'}`);

      // Applications: in progress (capped) and the five newest submissions (optionally searched)
      const appCols = `r.id AS id, r.authorityAppNumber AS authorityAppNumber, r.locationId AS locationId, r.status AS status,
        r.type AS type, r.requesterId AS requesterId, r.createdAt AS createdAt, l.name AS locationName,
        COALESCE(u.displayName, u.email) AS requesterName,
        (SELECT COUNT(*) FROM passRequestEmployees pre WHERE pre.requestId = r.id) AS employeeCount`;
      const appFrom = `passRequests r LEFT JOIN locations l ON l.id = r.locationId LEFT JOIN users u ON u.id = r.requesterId`;
      const activeApps = await rows(`SELECT ${appCols} FROM ${appFrom}
        WHERE r.deletedAt IS NULL AND ${openApp}${org('r')} ORDER BY r.createdAt DESC, r.id DESC ${cap(LIST_CAP)}`);
      const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 200).toLowerCase() : '';
      const qb: Record<string, unknown> = {};
      let qWhere = '';
      if (q) {
        qb.q = `%${q.replace(/[\\%_]/g, m => '\\' + m)}%`;
        qWhere = ` AND (LOWER(r.id) LIKE :q ESCAPE '\\' OR LOWER(r.authorityAppNumber) LIKE :q ESCAPE '\\' OR LOWER(l.name) LIKE :q ESCAPE '\\')`;
      }
      const recentApps = await rows(`SELECT ${appCols} FROM ${appFrom}
        WHERE r.deletedAt IS NULL${org('r')}${qWhere} ORDER BY COALESCE(r.createdAt, r.updatedAt) DESC, r.id DESC ${cap(5)}`, qb);

      // Active passes expiring after today: within 2 days (listed) and within 30 days (grouped)
      const soonWhere = `p.deletedAt IS NULL AND ${activePass}${org('p')} AND ${exp} > :today`;
      const expiring48h = await rows(`
        SELECT p.id AS id, p.employeeId AS employeeId, p.passNumber AS passNumber, p.expiryDate AS expiryDate,
               e.name AS employeeName, l.name AS locationName
          FROM passes p LEFT JOIN employees e ON e.id = p.employeeId LEFT JOIN locations l ON l.id = p.locationId
         WHERE ${soonWhere} AND ${exp} <= :in2
         ORDER BY ${exp} ASC, p.id ASC ${cap(LIST_CAP)}`, { today, in2 });
      const [exp48] = await rows(`SELECT COUNT(*) AS n FROM passes p WHERE ${soonWhere} AND ${exp} <= :in2`, { today, in2 });
      const byLocation = await rows(`
        SELECT COALESCE(l.name, 'Unknown') AS name, COUNT(*) AS n
          FROM passes p LEFT JOIN locations l ON l.id = p.locationId
         WHERE ${soonWhere} AND ${exp} <= :in30
         GROUP BY COALESCE(l.name, 'Unknown') ORDER BY COUNT(*) DESC`, { today, in30 });
      const byCategory = await rows(`
        SELECT COALESCE(c.name, 'Uncategorized') AS name, COUNT(*) AS n
          FROM passes p LEFT JOIN locations l ON l.id = p.locationId LEFT JOIN categories c ON c.id = l.categoryId
         WHERE ${soonWhere} AND ${exp} <= :in30
         GROUP BY COALESCE(c.name, 'Uncategorized') ORDER BY COUNT(*) DESC`, { today, in30 });

      // Active passes per location
      const perLocation = await rows(`
        SELECT p.locationId AS locationId, COUNT(*) AS n FROM passes p
         WHERE p.deletedAt IS NULL AND ${activePass}${org('p')} GROUP BY p.locationId`);

      const mapApp = (r: any) => ({
        id: v(r, 'id'), authorityAppNumber: v(r, 'authorityAppNumber') ?? null, locationId: v(r, 'locationId') ?? null,
        status: v(r, 'status') ?? '', type: v(r, 'type') ?? 'main', requesterId: v(r, 'requesterId') ?? null,
        createdAt: v(r, 'createdAt') ?? null, locationName: v(r, 'locationName') ?? null,
        requesterName: v(r, 'requesterName') ?? null, employeeCount: num(r, 'employeeCount'),
      });
      const activeByLocation: Record<string, number> = {};
      for (const r of perLocation) activeByLocation[String(v(r, 'locationId'))] = num(r, 'n');

      res.json({
        today,
        employeeCount: num(counts, 'employeeCount'),
        totalPassCount: num(counts, 'totalPassCount'),
        activePassCount: num(counts, 'activePassCount'),
        activeApplicationCount: num(counts, 'activeApplicationCount'),
        activeApplications: activeApps.map(mapApp),
        recentApplications: recentApps.map(mapApp),
        expiring48hCount: num(exp48, 'n'),
        expiring48h: expiring48h.map(r => ({
          id: v(r, 'id'), employeeId: v(r, 'employeeId'), passNumber: v(r, 'passNumber') ?? null,
          expiryDate: v(r, 'expiryDate'), employeeName: v(r, 'employeeName') ?? null, locationName: v(r, 'locationName') ?? null,
        })),
        expiringSoonCount: byLocation.reduce((s, r) => s + num(r, 'n'), 0),
        expiringByLocation: byLocation.map(r => [String(v(r, 'name')), num(r, 'n')]),
        expiringByCategory: byCategory.map(r => [String(v(r, 'name')), num(r, 'n')]),
        activeByLocation,
      });
    } catch (err) {
      logger.error('Error building dashboard', { err });
      res.status(500).json({ error: "Failed to load dashboard" });
    } finally {
      if (connection) await connection.close();
    }
  });
}
