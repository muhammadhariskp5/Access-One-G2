// --- Referential integrity: orphan report + foreign-key constraints ---
//
// Only relations whose parent rows are never hard-deleted are enforced (applications, passes,
// employees, locations and categories are soft-deleted). References to users, access codes and
// organizations are deliberately left out: those parents are still hard-deleted and history rows
// (audit, request history) must outlive them.
//
// A constraint is only added when its relation has no orphans, so enforcing never deletes or
// rewrites data. Relations with orphans are reported and skipped until the data is cleaned up.
import { logger } from './log.ts';

export interface Relation {
  name: string;   // constraint name
  child: string;
  column: string;
  parent: string;
}

export const RELATIONS: Relation[] = [
  { name: 'fk_pre_request',  child: 'passRequestEmployees',   column: 'requestId',    parent: 'passRequests' },
  { name: 'fk_pre_employee', child: 'passRequestEmployees',   column: 'employeeId',   parent: 'employees' },
  { name: 'fk_prac_request', child: 'passRequestAccessCodes', column: 'requestId',    parent: 'passRequests' },
  { name: 'fk_pac_pass',     child: 'passAccessCodes',        column: 'passId',       parent: 'passes' },
  { name: 'fk_hist_request', child: 'requestHistory',         column: 'requestId',    parent: 'passRequests' },
  { name: 'fk_pass_request', child: 'passes',                 column: 'requestId',    parent: 'passRequests' },
  { name: 'fk_pass_employee', child: 'passes',                column: 'employeeId',   parent: 'employees' },
  { name: 'fk_pass_location', child: 'passes',                column: 'locationId',   parent: 'locations' },
  { name: 'fk_pass_parent',  child: 'passes',                 column: 'parentPassId', parent: 'passes' },
  { name: 'fk_req_location', child: 'passRequests',           column: 'locationId',   parent: 'locations' },
  { name: 'fk_req_parent',   child: 'passRequests',           column: 'parentPassId', parent: 'passes' },
  { name: 'fk_loc_category', child: 'locations',              column: 'categoryId',   parent: 'categories' },
];

export interface RelationReport extends Relation {
  orphans: number;            // child rows pointing at no parent row
  caseOnlyMismatches: number; // ...of which a parent exists if case is ignored (fixable by normalising)
  samples: { id: string; ref: string }[];
  constraint: 'enforced' | 'missing' | 'not-supported';
}

const n = (row: any) => Number(row?.CNT ?? row?.cnt ?? 0);

// Child rows with a non-empty reference and no matching parent. LENGTH() > 0 excludes empty
// strings on SQLite (Oracle already stores '' as NULL).
const orphanWhere = (r: Relation) =>
  `c.${r.column} IS NOT NULL AND LENGTH(c.${r.column}) > 0 AND NOT EXISTS (SELECT 1 FROM ${r.parent} p WHERE p.id = c.${r.column})`;

async function existingConstraints(conn: any, engine: string): Promise<Set<string>> {
  if (engine !== 'oracle') return new Set();
  const oracledb = (await import('oracledb')).default;
  const res = await conn.execute(
    `SELECT constraint_name AS name FROM user_constraints WHERE constraint_type = 'R'`,
    {}, { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  return new Set(((res.rows || []) as any[]).map(r => String(r.NAME ?? r.name).toUpperCase()));
}

export async function integrityReport(conn: any, engine: string): Promise<RelationReport[]> {
  const oracledb = (await import('oracledb')).default;
  const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const constraints = await existingConstraints(conn, engine);
  const out: RelationReport[] = [];
  for (const r of RELATIONS) {
    const where = orphanWhere(r);
    const total = n((await conn.execute(`SELECT COUNT(*) AS cnt FROM ${r.child} c WHERE ${where}`, {}, opts)).rows?.[0]);
    let caseOnly = 0;
    let samples: { id: string; ref: string }[] = [];
    if (total > 0) {
      caseOnly = n((await conn.execute(
        `SELECT COUNT(*) AS cnt FROM ${r.child} c WHERE ${where} AND EXISTS (SELECT 1 FROM ${r.parent} p WHERE UPPER(p.id) = UPPER(c.${r.column}))`,
        {}, opts)).rows?.[0]);
      const s = await conn.execute(
        `SELECT c.id AS cid, c.${r.column} AS ref FROM ${r.child} c WHERE ${where} FETCH FIRST 5 ROWS ONLY`, {}, opts);
      samples = ((s.rows || []) as any[]).map(x => ({ id: String(x.CID ?? x.cid), ref: String(x.REF ?? x.ref) }));
    }
    out.push({
      ...r,
      orphans: total,
      caseOnlyMismatches: caseOnly,
      samples,
      constraint: engine !== 'oracle' ? 'not-supported' : (constraints.has(r.name.toUpperCase()) ? 'enforced' : 'missing'),
    });
  }
  return out;
}

// Adds each missing constraint whose relation is clean. Constraints are DEFERRABLE INITIALLY
// DEFERRED: checked at commit, so a save that writes rows in any order inside one transaction
// still works, and a save that would leave a dangling reference is rolled back as a whole.
// SQLite (dev/tests) cannot add constraints to existing tables, so this is Oracle-only.
export async function enforceForeignKeys(conn: any, engine: string): Promise<{ added: string[]; skipped: { name: string; orphans: number }[] }> {
  const added: string[] = [];
  const skipped: { name: string; orphans: number }[] = [];
  if (engine !== 'oracle') return { added, skipped };
  const report = await integrityReport(conn, engine);
  for (const r of report) {
    if (r.constraint === 'enforced') continue;
    if (r.orphans > 0) {
      skipped.push({ name: r.name, orphans: r.orphans });
      continue;
    }
    try {
      await conn.execute(
        `ALTER TABLE ${r.child} ADD CONSTRAINT ${r.name} FOREIGN KEY (${r.column}) REFERENCES ${r.parent} (id) DEFERRABLE INITIALLY DEFERRED`
      );
      added.push(r.name);
    } catch (e: any) {
      // ORA-02275: already exists under this name. ORA-02298: an orphan appeared since the report.
      if (/ORA-02275/.test(String(e?.message))) continue;
      if (/ORA-02298/.test(String(e?.message))) { skipped.push({ name: r.name, orphans: -1 }); continue; }
      throw e;
    }
  }
  if (added.length) logger.info('[Integrity] foreign keys added', { added });
  if (skipped.length) logger.warn('[Integrity] foreign keys skipped: orphan rows present (see /api/platform/integrity)', { skipped });
  return { added, skipped };
}
