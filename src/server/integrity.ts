// --- Referential integrity: orphan report, case repair, foreign-key constraints ---
//
// Every parent table referenced here is soft-deleted (rows are marked deletedAt, never removed),
// so foreign keys never block a delete and history always resolves to its record. Automatic
// actions are attributed to the reserved 'system' account row, so it is a real reference too.
//
// Audit logs are intentionally not constrained: they are an append-only record that is archived
// and expired on its own schedule, and they already store the actor's name and email.
//
// Rules:
//  - Reporting never changes data.
//  - Case repair only re-points a reference to the one parent row it matches when case is
//    ignored (e.g. 'abc123' -> 'ABC123'); ambiguous or missing parents are left alone.
//  - A constraint is only added to a relation that is already clean; nothing is ever deleted
//    to make a constraint fit.
import crypto from 'crypto';
import { logger } from './log.ts';

export const SYSTEM_USER_ID = 'system';

export interface Relation {
  name: string;   // constraint name
  group: 'Applications & passes' | 'People' | 'Access codes' | 'Organizations';
  label: string;  // plain-language description for the report screen
  child: string;
  column: string;
  parent: string;
}

const org = (child: string, label: string): Relation =>
  ({ name: `fk_${child.toLowerCase().slice(0, 16)}_org`, group: 'Organizations', label, child, column: 'organizationId', parent: 'organizations' });

export const RELATIONS: Relation[] = [
  { name: 'fk_pre_request',   group: 'Applications & passes', label: 'Employee link → application',      child: 'passRequestEmployees',   column: 'requestId',    parent: 'passRequests' },
  { name: 'fk_pre_employee',  group: 'Applications & passes', label: 'Employee link → employee',         child: 'passRequestEmployees',   column: 'employeeId',   parent: 'employees' },
  { name: 'fk_hist_request',  group: 'Applications & passes', label: 'Application history → application', child: 'requestHistory',       column: 'requestId',    parent: 'passRequests' },
  { name: 'fk_pass_request',  group: 'Applications & passes', label: 'Pass → application',               child: 'passes',                 column: 'requestId',    parent: 'passRequests' },
  { name: 'fk_pass_employee', group: 'Applications & passes', label: 'Pass → employee',                  child: 'passes',                 column: 'employeeId',   parent: 'employees' },
  { name: 'fk_pass_location', group: 'Applications & passes', label: 'Pass → location',                  child: 'passes',                 column: 'locationId',   parent: 'locations' },
  { name: 'fk_pass_parent',   group: 'Applications & passes', label: 'Supplementary pass → main pass',   child: 'passes',                 column: 'parentPassId', parent: 'passes' },
  { name: 'fk_req_location',  group: 'Applications & passes', label: 'Application → location',           child: 'passRequests',           column: 'locationId',   parent: 'locations' },
  { name: 'fk_req_parent',    group: 'Applications & passes', label: 'Application → main pass',          child: 'passRequests',           column: 'parentPassId', parent: 'passes' },
  { name: 'fk_loc_category',  group: 'Applications & passes', label: 'Location → category',              child: 'locations',              column: 'categoryId',   parent: 'categories' },

  { name: 'fk_req_requester', group: 'People', label: 'Application → requester',        child: 'passRequests',   column: 'requesterId',   parent: 'users' },
  { name: 'fk_req_approver',  group: 'People', label: 'Application → approver',         child: 'passRequests',   column: 'approverId',    parent: 'users' },
  { name: 'fk_req_forwarded', group: 'People', label: 'Application → forwarded to',     child: 'passRequests',   column: 'forwardedToId', parent: 'users' },
  { name: 'fk_hist_user',     group: 'People', label: 'Application history → user',     child: 'requestHistory', column: 'userId',        parent: 'users' },
  { name: 'fk_notif_user',    group: 'People', label: 'Notification → recipient',       child: 'notifications',  column: 'userId',        parent: 'users' },

  { name: 'fk_prac_request',  group: 'Access codes', label: 'Application access code → application', child: 'passRequestAccessCodes', column: 'requestId',    parent: 'passRequests' },
  { name: 'fk_prac_code',     group: 'Access codes', label: 'Application access code → access code', child: 'passRequestAccessCodes', column: 'accessCodeId', parent: 'accessCodes' },
  { name: 'fk_pac_pass',      group: 'Access codes', label: 'Pass access code → pass',               child: 'passAccessCodes',        column: 'passId',       parent: 'passes' },
  { name: 'fk_pac_code',      group: 'Access codes', label: 'Pass access code → access code',        child: 'passAccessCodes',        column: 'accessCodeId', parent: 'accessCodes' },
  { name: 'fk_code_location', group: 'Access codes', label: 'Access code → location',                child: 'accessCodes',            column: 'locationId',   parent: 'locations' },

  org('users', 'User → organization'),
  org('employees', 'Employee → organization'),
  org('passes', 'Pass → organization'),
  org('passRequests', 'Application → organization'),
  org('locations', 'Location → organization'),
  org('categories', 'Category → organization'),
  org('accessCodes', 'Access code → organization'),
  org('notifications', 'Notification → organization'),
  org('divisions', 'Division → organization'),
  org('departments', 'Department → organization'),
];

export interface RelationReport extends Relation {
  rows: number;               // child rows that hold a reference
  orphans: number;            // ...pointing at no parent row
  caseOnlyMismatches: number; // ...of which exactly one parent matches when case is ignored (repairable)
  samples: { id: string; ref: string }[];
  constraint: 'enforced' | 'missing' | 'not-supported';
  error?: string;             // the relation could not be checked (e.g. column absent in this schema)
}

const n = (row: any) => Number(row?.CNT ?? row?.cnt ?? 0);

// Unaliased so the same text works inside UPDATE (SQLite has no UPDATE aliases). Inside the
// subqueries the parent is aliased p, so "<child>.<column>" always means the outer row, also
// for the self-reference passes.parentPassId -> passes.
const hasRef = (r: Relation) => `${r.child}.${r.column} IS NOT NULL AND LENGTH(${r.child}.${r.column}) > 0`;
const noExactParent = (r: Relation) => `NOT EXISTS (SELECT 1 FROM ${r.parent} p WHERE p.id = ${r.child}.${r.column})`;
const singleCaseParent = (r: Relation) => `(SELECT COUNT(*) FROM ${r.parent} p WHERE UPPER(p.id) = UPPER(${r.child}.${r.column})) = 1`;

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
    const base: RelationReport = {
      ...r, rows: 0, orphans: 0, caseOnlyMismatches: 0, samples: [],
      constraint: engine !== 'oracle' ? 'not-supported' : (constraints.has(r.name.toUpperCase()) ? 'enforced' : 'missing'),
    };
    try {
      base.rows = n((await conn.execute(`SELECT COUNT(*) AS cnt FROM ${r.child} WHERE ${hasRef(r)}`, {}, opts)).rows?.[0]);
      const orphanWhere = `${hasRef(r)} AND ${noExactParent(r)}`;
      base.orphans = base.rows === 0 ? 0 : n((await conn.execute(`SELECT COUNT(*) AS cnt FROM ${r.child} WHERE ${orphanWhere}`, {}, opts)).rows?.[0]);
      if (base.orphans > 0) {
        base.caseOnlyMismatches = n((await conn.execute(
          `SELECT COUNT(*) AS cnt FROM ${r.child} WHERE ${orphanWhere} AND ${singleCaseParent(r)}`, {}, opts)).rows?.[0]);
        const s = await conn.execute(
          `SELECT ${r.child}.id AS cid, ${r.child}.${r.column} AS ref FROM ${r.child} WHERE ${orphanWhere} FETCH FIRST 5 ROWS ONLY`, {}, opts);
        base.samples = ((s.rows || []) as any[]).map(x => ({ id: String(x.CID ?? x.cid), ref: String(x.REF ?? x.ref) }));
      }
    } catch (e: any) {
      base.error = String(e?.message || e).split('\n')[0];
    }
    out.push(base);
  }
  return out;
}

// Re-points references that differ from their parent's ID only in letter case. Returns rows fixed
// per relation. The caller commits.
export async function repairCaseMismatches(conn: any): Promise<{ name: string; fixed: number }[]> {
  const fixed: { name: string; fixed: number }[] = [];
  for (const r of RELATIONS) {
    try {
      const res = await conn.execute(
        `UPDATE ${r.child} SET ${r.column} = (SELECT MIN(p.id) FROM ${r.parent} p WHERE UPPER(p.id) = UPPER(${r.child}.${r.column}))
         WHERE ${hasRef(r)} AND ${noExactParent(r)} AND ${singleCaseParent(r)}`
      );
      const count = Number(res?.rowsAffected || 0);
      if (count > 0) fixed.push({ name: r.name, fixed: count });
    } catch (e: any) {
      logger.warn(`[Integrity] case repair skipped for ${r.name}`, { err: String(e?.message || e).split('\n')[0] });
    }
  }
  if (fixed.length) logger.info('[Integrity] case-only references repaired', { fixed });
  return fixed;
}

// The reserved account that automatic actions (daily job, imports, system-created history) are
// attributed to. It cannot log in: its password field is not a valid hash and it is never active.
export async function ensureSystemUser(conn: any): Promise<void> {
  const oracledb = (await import('oracledb')).default;
  const res = await conn.execute(`SELECT id FROM users WHERE id = :id`, [SYSTEM_USER_ID], { outFormat: oracledb.OUT_FORMAT_OBJECT });
  if (res.rows && res.rows.length > 0) return;
  await conn.execute(
    `INSERT INTO users (id, email, password, role, displayName, status, createdAt)
     VALUES (:id, :email, :password, 'system', 'System', 'system', :createdAt)`,
    {
      id: SYSTEM_USER_ID,
      email: 'system@accessone.invalid',
      password: `!locked-${crypto.randomBytes(16).toString('hex')}`,
      createdAt: new Date().toISOString(),
    }
  );
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
    if (r.constraint === 'enforced' || r.error) continue;
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
  if (skipped.length) logger.warn('[Integrity] foreign keys skipped: orphan rows present (see Data Integrity in the platform portal)', { skipped });
  return { added, skipped };
}
