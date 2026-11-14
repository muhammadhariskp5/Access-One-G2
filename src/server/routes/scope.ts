import express from "express";
import { logger } from "../log.ts";
import { attachPeople } from "../requestLinks.ts";
import type { RouteContext } from "../context.ts";

// --- Scoped records for the application workspace and the application form ---
// Those screens apply per-person rules (one active main pass per category, no duplicate
// application in progress, ...) that only ever look at the people involved. Instead of the whole
// employee / pass / application lists, they ask for exactly the records those rules can match:
// the people (by ID, by identifier from an import, or by a picker search), the applications
// asked for, and every pass and application those people have. The rules run unchanged on that set.
// Body: { applicationIds?, employeeIds?, identifiers?, q? }  ->  { employees, passes, applications }

const MAX_IDS = 2000;
const SEARCH_LIMIT = 50;

export function registerScopeRoutes(app: express.Express, ctx: RouteContext) {
  const { oracledb, authorize, getConnection, getTenantOrgId, toCamelCase } = ctx;

  app.post("/api/scope", authorize(['admin', 'approver', 'applier', 'viewer']), async (req, res) => {
    let connection;
    try {
      const list = (v: unknown) => Array.from(new Set((Array.isArray(v) ? v : [])
        .map(x => (typeof x === 'string' || typeof x === 'number' ? String(x).trim() : ''))
        .filter(x => x && x.length <= 255))).slice(0, MAX_IDS) as string[];
      const applicationIds = list(req.body?.applicationIds);
      const employeeIds = list(req.body?.employeeIds);
      const identifiers = list(req.body?.identifiers);
      const q = typeof req.body?.q === 'string' ? req.body.q.trim().slice(0, 200) : null;

      connection = await getConnection();
      const { orgId } = await getTenantOrgId(req, connection);
      const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
      const g = (row: any, k: string) => row[k.toUpperCase()] ?? row[k] ?? null;

      // Run `sql` (with {IN} replaced by a bind list) over `values` in chunks
      const inChunks = async (values: string[], sql: (inList: string) => string, extra: Record<string, unknown> = {}) => {
        const rows: any[] = [];
        for (let i = 0; i < values.length; i += 500) {
          const chunk = values.slice(i, i + 500);
          const binds: Record<string, unknown> = { ...extra };
          chunk.forEach((v, j) => { binds[`v${j}`] = v; });
          const r = await connection.execute(sql(chunk.map((_, j) => `:v${j}`).join(', ')), binds, opts);
          rows.push(...((r.rows || []) as any[]));
        }
        return rows;
      };
      const orgBind = orgId ? { orgId } : {};
      const org = (alias: string) => (orgId ? ` AND ${alias}.organizationId = :orgId` : '');

      // 1. Applications asked for (by ID or authority number, any letter case)
      const askedApps = applicationIds.length === 0 ? [] : await inChunks(
        applicationIds.map(v => v.toLowerCase()),
        inList => `SELECT r.id FROM passRequests r WHERE r.deletedAt IS NULL${org('r')}
                    AND (LOWER(r.id) IN (${inList}) OR LOWER(r.authorityAppNumber) IN (${inList}))`,
        orgBind
      );
      const askedAppIds = askedApps.map(r => String(g(r, 'id')));

      // 2. The people: asked for, on those applications, matching import identifiers, or a search
      const people = new Set<string>(employeeIds);
      if (askedAppIds.length) {
        for (const r of await inChunks(askedAppIds, inList => `SELECT employeeId FROM passRequestEmployees WHERE requestId IN (${inList})`)) {
          people.add(String(g(r, 'employeeId')));
        }
      }
      if (identifiers.length) {
        for (const r of await inChunks(identifiers, inList => `SELECT e.id FROM employees e WHERE e.deletedAt IS NULL${org('e')}
            AND (e.employeeId IN (${inList}) OR e.qatarId IN (${inList}) OR e.qidVisaNumber IN (${inList}) OR e.visaNumber IN (${inList}) OR e.id IN (${inList}))`, orgBind)) {
          people.add(String(g(r, 'id')));
        }
      }
      if (q !== null) {
        const binds: Record<string, unknown> = { ...orgBind };
        let where = `e.deletedAt IS NULL AND LOWER(COALESCE(e.status, '')) <> 'inactive'${org('e')}`;
        if (q) {
          binds.q = `%${q.toLowerCase().replace(/[\\%_]/g, m => '\\' + m)}%`;
          const like = (c: string) => `LOWER(${c}) LIKE :q ESCAPE '\\'`;
          where += ` AND (${[like('e.name'), like('e.employeeId'), like('e.qatarId'), like('e.jobTitle'), like('e.department')].join(' OR ')})`;
        }
        const r = await connection.execute(
          `SELECT e.id FROM employees e WHERE ${where} ORDER BY e.name, e.id FETCH FIRST ${SEARCH_LIMIT} ROWS ONLY`, binds, opts);
        for (const row of (r.rows || []) as any[]) people.add(String(g(row, 'id')));
      }
      const personIds = Array.from(people).filter(Boolean).slice(0, MAX_IDS);

      // 3. Employee rows (live, this organization)
      const employees = (personIds.length === 0 ? [] : await inChunks(personIds,
        inList => `SELECT * FROM employees e WHERE e.id IN (${inList}) AND e.deletedAt IS NULL${org('e')}`, orgBind
      )).map(toCamelCase);

      // 4. Every live pass of these people, and every pass of the applications asked for
      const passRows = new Map<string, any>();
      const addPasses = (rows: any[]) => rows.forEach(p => passRows.set(String(g(p, 'id')), p));
      if (personIds.length) addPasses(await inChunks(personIds, inList => `SELECT * FROM passes p WHERE p.employeeId IN (${inList}) AND p.deletedAt IS NULL${org('p')}`, orgBind));
      if (askedAppIds.length) addPasses(await inChunks(askedAppIds, inList => `SELECT * FROM passes p WHERE p.requestId IN (${inList}) AND p.deletedAt IS NULL${org('p')}`, orgBind));
      const passes = Array.from(passRows.values()).map(p => ({
        ...toCamelCase(p),
        accessCodes: (() => { try { return JSON.parse(p.ACCESSCODES || p.accessCodes || '[]'); } catch { return []; } })(),
        authorityAppNumber: g(p, 'authorityAppNumber'),
      }));

      // 5. Every application these people are on, plus the ones asked for (people from the link table)
      const appIdSet = new Set<string>(askedAppIds);
      if (personIds.length) {
        for (const r of await inChunks(personIds, inList => `SELECT DISTINCT requestId FROM passRequestEmployees WHERE employeeId IN (${inList})`)) {
          appIdSet.add(String(g(r, 'requestId')));
        }
      }
      const appRows = appIdSet.size === 0 ? [] : await inChunks(Array.from(appIdSet),
        inList => `SELECT * FROM passRequests r WHERE r.id IN (${inList}) AND r.deletedAt IS NULL${org('r')}`, orgBind);
      const parse = (v: unknown, f: unknown) => { try { return v ? JSON.parse(String(v)) : f; } catch { return f; } };
      const applications = await attachPeople(connection, appRows.map(r => ({
        ...toCamelCase(r),
        temporaryNames: parse(g(r, 'temporaryNames'), []),
        accessCodes: parse(g(r, 'accessCodes'), []),
      })));

      res.json({ employees, passes, applications });
    } catch (err) {
      logger.error('Error loading scoped records', { err });
      res.status(500).json({ error: "Failed to load records" });
    } finally {
      if (connection) await connection.close();
    }
  });
}
