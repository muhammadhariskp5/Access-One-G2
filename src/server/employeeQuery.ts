// --- Server-side employee listing: search, filters, duplicate detection, sort, paging ---
// The database does the work and returns one page, instead of the browser downloading every
// employee and filtering in memory. Every input is whitelisted or bound; nothing from the query
// string is concatenated into SQL.

export const EMPLOYEE_PAGE_SIZE_MAX = 200;
export const EMPLOYEE_EXPORT_MAX = 20000;

// Sortable columns -> SQL expression (same fallbacks the table displays)
const SORTS: Record<string, string> = {
  name: 'name',
  code: 'employeeId',
  jobTitle: 'jobTitle',
  type: 'employeeType',
  status: 'status',
  division: 'division',
  department: 'department',
  qidNumber: 'COALESCE(qidVisaNumber, qatarId, visaNumber)',
  qidExpiry: 'COALESCE(qidVisaExpiry, visaExpiry)',
  expiry: 'COALESCE(qidVisaExpiry, visaExpiry)',
  passportNumber: 'passportNumber',
  passportExpiry: 'passportExpiry',
  passport: 'passportExpiry',
  induction: 'safetyInductionDate',
};

const SEARCH_COLUMNS = ['name', 'employeeId', 'department', 'division', 'project', 'jobTitle', 'email', 'qatarId', 'visaNumber', 'qidVisaNumber', 'passportNumber'];

// Normalised duplicate keys (empty values never count as duplicates)
const norm = (expr: string) => `NULLIF(LOWER(TRIM(${expr})), '')`;
const DUP_KEYS: { reason: string; expr: string }[] = [
  { reason: 'Duplicate Name', expr: norm('name') },
  { reason: 'Duplicate Code', expr: norm('employeeId') },
  { reason: 'Duplicate QID/Visa', expr: `COALESCE(${norm('qatarId')}, ${norm('visaNumber')}, ${norm('qidVisaNumber')})` },
  { reason: 'Duplicate Passport', expr: norm('passportNumber') },
];

export interface EmployeeListQuery {
  q: string;
  type: string;
  status: string;
  division: string;
  department: string;
  project: string;
  duplicates: boolean;
  sort: string;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
  all: boolean; // export / print: every matching row (capped)
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const isSet = (v: string) => v !== '' && v.toLowerCase() !== 'all';

export function parseEmployeeListQuery(query: Record<string, unknown>): EmployeeListQuery {
  const page = Math.max(1, parseInt(str(query.page), 10) || 1);
  const pageSize = Math.min(EMPLOYEE_PAGE_SIZE_MAX, Math.max(1, parseInt(str(query.pageSize), 10) || 50));
  const sort = SORTS[str(query.sort)] ? str(query.sort) : 'name';
  return {
    q: str(query.q).slice(0, 200),
    type: str(query.type),
    status: str(query.status),
    division: str(query.division),
    department: str(query.department),
    project: str(query.project),
    duplicates: str(query.duplicates) === '1' || str(query.duplicates) === 'true',
    sort,
    order: str(query.order) === 'desc' ? 'desc' : 'asc',
    page,
    pageSize,
    all: str(query.all) === '1' || str(query.all) === 'true',
  };
}

// Builds "WHERE ..." for the tenant scope only (used for duplicate key groups, which are
// computed across the whole organization, not just the filtered rows).
function scopeWhere(orgId: string | null, binds: Record<string, unknown>, alias = ''): string {
  const a = alias ? `${alias}.` : '';
  let w = `${a}deletedAt IS NULL`;
  if (orgId) { w += ` AND ${a}organizationId = :orgId`; binds.orgId = orgId; }
  return w;
}

// "<key> IN (keys that occur more than once in this organization)"
function dupCondition(expr: string, orgId: string | null, binds: Record<string, unknown>): string {
  return `${expr} IN (SELECT ${expr} FROM employees WHERE ${scopeWhere(orgId, binds)} AND ${expr} IS NOT NULL GROUP BY ${expr} HAVING COUNT(*) > 1)`;
}

function anyDuplicate(orgId: string | null, binds: Record<string, unknown>): string {
  return `(${DUP_KEYS.map(k => dupCondition(k.expr, orgId, binds)).join(' OR ')})`;
}

export function buildEmployeeFilter(f: EmployeeListQuery, orgId: string | null): { where: string; binds: Record<string, unknown> } {
  const binds: Record<string, unknown> = {};
  const parts: string[] = [scopeWhere(orgId, binds)];

  if (f.q) {
    // Escape LIKE wildcards so a search for "50%" matches literally.
    binds.q = `%${f.q.toLowerCase().replace(/[\\%_]/g, m => '\\' + m)}%`;
    parts.push(`(${SEARCH_COLUMNS.map(c => `LOWER(${c}) LIKE :q ESCAPE '\\'`).join(' OR ')})`);
  }
  if (isSet(f.type)) {
    if (f.type === 'External Sponsor') parts.push(`LOWER(employeeType) LIKE '%sponsor%'`);
    else if (f.type === 'Externally Working') parts.push(`LOWER(employeeType) LIKE '%working%'`);
    else { parts.push(`LOWER(employeeType) = LOWER(:type)`); binds.type = f.type; }
  }
  if (isSet(f.status)) { parts.push(`LOWER(status) = LOWER(:status)`); binds.status = f.status; }
  // Division / department / project may be stored as a name or (legacy) as the record's id.
  const named = (col: string, table: string, key: string, value: string) => {
    if (!isSet(value)) return;
    binds[key] = value;
    parts.push(`(LOWER(${col}) = LOWER(:${key}) OR ${col} IN (SELECT id FROM ${table} WHERE LOWER(name) = LOWER(:${key})))`);
  };
  named('division', 'divisions', 'division', f.division);
  named('department', 'departments', 'department', f.department);
  named('project', 'projects', 'project', f.project);
  if (f.duplicates) parts.push(anyDuplicate(orgId, binds));

  return { where: parts.join(' AND '), binds };
}

export function orderBy(f: EmployeeListQuery): string {
  const dir = f.order === 'desc' ? 'DESC' : 'ASC';
  // Empty values sort first ascending (as the table always did); id makes paging stable.
  return `ORDER BY ${SORTS[f.sort]} ${dir} ${dir === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST'}, id ASC`;
}

export function pageClause(engine: string, offset: number, limit: number): string {
  const o = Math.max(0, Math.floor(offset));
  const l = Math.max(1, Math.floor(limit));
  return engine === 'oracle' ? `OFFSET ${o} ROWS FETCH NEXT ${l} ROWS ONLY` : `LIMIT ${l} OFFSET ${o}`;
}

// Duplicate reasons for the rows on this page only.
export async function duplicateReasonsFor(conn: any, ids: string[], orgId: string | null): Promise<Record<string, string[]>> {
  const out: Record<string, string[]> = {};
  if (ids.length === 0) return out;
  const oracledb = (await import('oracledb')).default;
  const binds: Record<string, unknown> = {};
  ids.forEach((id, i) => { binds[`i${i}`] = id; });
  const idList = ids.map((_, i) => `:i${i}`).join(', ');
  const cols = DUP_KEYS.map((k, i) => `CASE WHEN ${dupCondition(k.expr, orgId, binds)} THEN 1 ELSE 0 END AS d${i}`).join(', ');
  const res = await conn.execute(`SELECT id, ${cols} FROM employees WHERE id IN (${idList})`, binds, { outFormat: oracledb.OUT_FORMAT_OBJECT });
  for (const row of (res.rows || []) as any[]) {
    const reasons = DUP_KEYS.filter((_, i) => Number(row[`D${i}`] ?? row[`d${i}`]) === 1).map(k => k.reason);
    if (reasons.length) out[String(row.ID ?? row.id)] = reasons;
  }
  return out;
}

export async function countDuplicates(conn: any, orgId: string | null): Promise<number> {
  const oracledb = (await import('oracledb')).default;
  const binds: Record<string, unknown> = {};
  const res = await conn.execute(
    `SELECT COUNT(*) AS cnt FROM employees WHERE ${scopeWhere(orgId, binds)} AND ${anyDuplicate(orgId, binds)}`,
    binds, { outFormat: oracledb.OUT_FORMAT_OBJECT }
  );
  const row: any = res.rows?.[0];
  return Number(row?.CNT ?? row?.cnt ?? 0);
}
