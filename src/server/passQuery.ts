// --- Server-side pass listing (Pass Status Management): search, status, dates, sort, paging ---
// The list is every live pass plus one "virtual" row for each person on an application who has
// no pass yet (same merge the screen used to do in the browser). The database builds, filters,
// sorts and pages it; employee and location names are joined in so the browser doesn't need the
// full employee list. Every input is whitelisted or bound.

export const PASS_PAGE_SIZE_MAX = 200;
export const PASS_EXPORT_MAX = 20000;

const HISTORY = ['expired', 'replaced', 'superseded', 'revoked', 'cancelled', 'rejected', 'archived', 'inactive', 'deleted'];

// Status filter -> statuses it matches (mirrors filterPassApplicationItem in utils/passStatus.ts)
export const STATUS_GROUPS: Record<string, string[]> = {
  active: ['active', 'collected', 'completed'],
  collected: ['active', 'collected', 'completed'],
  issued: ['issued', 'ready_for_collection', 'partially_issued'],
  ready_for_collection: ['issued', 'ready_for_collection', 'partially_issued'],
  accepted: ['accepted', 'approved'],
  approved: ['accepted', 'approved'],
  processing: ['processing', 'under_processing', 'forwarded', 'clarification'],
  under_processing: ['processing', 'under_processing', 'forwarded', 'clarification'],
  pending: ['pending', 'under_review', 'review'],
  under_review: ['pending', 'under_review', 'review'],
  completed: ['completed', 'collected'],
  expired: ['expired'],
  revoked: ['revoked'],
  replaced: ['replaced', 'superseded'],
  cancelled: ['cancelled', 'rejected'],
  rejected: ['cancelled', 'rejected'],
  archived: ['archived'],
};

// A stored date (ISO, YYYY/MM/DD or DD-MM-YYYY / DD/MM/YYYY) as YYYY-MM-DD, like parseToYMD.
export function ymd(expr: string): string {
  const e = `NULLIF(TRIM(${expr}), '')`;
  return `(CASE WHEN SUBSTR(${e}, 3, 1) IN ('-', '/') AND SUBSTR(${e}, 6, 1) IN ('-', '/')
    THEN SUBSTR(${e}, 7, 4) || '-' || SUBSTR(${e}, 4, 2) || '-' || SUBSTR(${e}, 1, 2)
    ELSE REPLACE(SUBSTR(${e}, 1, 10), '/', '-') END)`;
}

const START = ymd('COALESCE(x.startDate, x.issueDate, x.createdAt)');
const END = ymd('COALESCE(x.expiryDate, x.endDate)');

const SORTS: Record<string, string> = {
  employee: 'e.name',
  name: 'e.name',
  employeeId: 'e.employeeId',
  jobTitle: 'e.jobTitle',
  passInfo: 'COALESCE(x.passNumber, x.id)',
  location: 'l.name',
  validity: END,
  status: 'LOWER(x.status)',
};

const SEARCH = ['e.name', 'e.employeeId', 'e.qatarId', 'e.passportNumber', 'l.name', 'x.passNumber', 'x.id', 'x.requestId'];

export interface PassListQuery {
  q: string;
  status: string;
  from: string | null; // YYYY-MM-DD
  to: string | null;
  sort: string;
  order: 'asc' | 'desc';
  page: number;
  pageSize: number;
  all: boolean;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const dateParam = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : null);

export function parsePassListQuery(query: Record<string, unknown>): PassListQuery {
  return {
    q: str(query.q).slice(0, 200),
    status: str(query.status).toLowerCase() || 'all',
    from: dateParam(query.from),
    to: dateParam(query.to),
    sort: SORTS[str(query.sort)] ? str(query.sort) : 'employee',
    order: str(query.order) === 'desc' ? 'desc' : 'asc',
    page: Math.max(1, parseInt(str(query.page), 10) || 1),
    pageSize: Math.min(PASS_PAGE_SIZE_MAX, Math.max(1, parseInt(str(query.pageSize), 10) || 50)),
    all: str(query.all) === '1' || str(query.all) === 'true',
  };
}

// Live passes + people on applications without a pass yet, scoped to the organization.
function combinedSource(engine: string, orgId: string | null, binds: Record<string, unknown>): string {
  // Oracle needs both sides of the UNION to agree on LOB-ness, whatever an old table was created with.
  const lob = (c: string) => (engine === 'oracle' ? `TO_CLOB(${c})` : c);
  if (orgId) binds.orgId = orgId;
  const realOrg = orgId ? ' AND p.organizationId = :orgId' : '';
  const appOrg = orgId ? ' AND r.organizationId = :orgId' : '';
  return `
    SELECT p.id AS id, p.requestId AS requestId, p.employeeId AS employeeId, p.locationId AS locationId,
           p.type AS type, p.status AS status, p.startDate AS startDate, CAST(NULL AS VARCHAR2(50)) AS issueDate,
           p.expiryDate AS expiryDate, p.endDate AS endDate, p.passNumber AS passNumber, p.cardNumber AS cardNumber,
           ${lob('p.accessCodes')} AS accessCodes, p.parentPassId AS parentPassId, p.authorityAppNumber AS authorityAppNumber,
           p.contractNumber AS contractNumber, p.clientCompany AS clientCompany, p.remarks AS remarks,
           p.handoverBy AS handoverBy, p.createdAt AS createdAt, p.updatedAt AS updatedAt, 0 AS isVirtual
      FROM passes p
     WHERE p.deletedAt IS NULL${realOrg}
    UNION ALL
    SELECT 'virtual-' || r.id || '-' || pre.employeeId, r.id, pre.employeeId, r.locationId,
           COALESCE(r.type, 'main'),
           CASE LOWER(COALESCE(pre.status, r.status, 'pending'))
             WHEN 'completed' THEN 'collected' WHEN 'collected' THEN 'collected'
             WHEN 'accepted' THEN 'accepted' WHEN 'approved' THEN 'approved'
             WHEN 'cancelled' THEN 'cancelled' WHEN 'rejected' THEN 'rejected'
             WHEN 'active' THEN 'active' WHEN 'expired' THEN 'expired'
             WHEN 'replaced' THEN 'replaced' WHEN 'pending' THEN 'pending'
             ELSE 'processing' END,
           CAST(NULL AS VARCHAR2(50)), r.createdAt,
           COALESCE(pre.expiryDate, r.endDate), CAST(NULL AS VARCHAR2(50)),
           COALESCE(r.authorityAppNumber, UPPER(r.id)), CAST(NULL AS VARCHAR2(100)),
           ${lob('r.accessCodes')}, r.parentPassId, r.authorityAppNumber,
           r.contractNumber, r.clientCompany, CAST(NULL AS VARCHAR2(1000)),
           CAST(NULL AS VARCHAR2(255)), r.createdAt, r.updatedAt, 1
      FROM passRequestEmployees pre
      JOIN passRequests r ON r.id = pre.requestId
     WHERE r.deletedAt IS NULL${appOrg}
       AND NOT EXISTS (SELECT 1 FROM passes p2 WHERE p2.deletedAt IS NULL AND p2.requestId = r.id AND p2.employeeId = pre.employeeId)`;
}

export function buildPassList(engine: string, f: PassListQuery, orgId: string | null): { from: string; where: string; binds: Record<string, unknown> } {
  const binds: Record<string, unknown> = {};
  const from = `(${combinedSource(engine, orgId, binds)}) x
    LEFT JOIN employees e ON e.id = x.employeeId
    LEFT JOIN locations l ON l.id = x.locationId`;
  const parts: string[] = ['1 = 1'];
  const status = `COALESCE(LOWER(x.status), '~')`;
  const searching = f.q.length >= 2;

  if (f.q) {
    binds.q = `%${f.q.toLowerCase().replace(/[\\%_]/g, m => '\\' + m)}%`;
    parts.push(`(${SEARCH.map(c => `LOWER(${c}) LIKE :q ESCAPE '\\'`).join(' OR ')})`);
  }

  // History (expired, revoked, replaced, ...) is kept but only listed when searched for or when
  // its status is picked; replaced passes only under "Replaced".
  if (f.status === 'all') {
    if (!searching) parts.push(`${status} NOT IN (${HISTORY.map(s => `'${s}'`).join(', ')})`);
  } else {
    const group = STATUS_GROUPS[f.status];
    if (group) {
      parts.push(`${status} IN (${group.map(s => `'${s}'`).join(', ')})`);
    } else {
      binds.status = f.status;
      parts.push(`${status} = :status`);
      if (f.status !== 'replaced') parts.push(`${status} NOT IN ('replaced', 'superseded')`);
    }
  }

  // Date range: valid on/after "from", and within "to"
  if (f.from) { binds.dFrom = f.from; parts.push(`NOT (${END} IS NOT NULL AND ${END} < :dFrom)`); }
  if (f.to) {
    binds.dTo = f.to;
    parts.push(`COALESCE(${START}, '1970-01-01') <= :dTo`);
    parts.push(`NOT (${END} IS NOT NULL AND ${END} > :dTo)`);
  }

  return { from, where: parts.join(' AND '), binds };
}

export function passOrderBy(f: PassListQuery): string {
  const dir = f.order === 'desc' ? 'DESC' : 'ASC';
  return `ORDER BY ${SORTS[f.sort]} ${dir} ${dir === 'ASC' ? 'NULLS FIRST' : 'NULLS LAST'}, x.id ASC`;
}

export const PASS_LIST_COLUMNS = `x.*, e.name AS employeeName, e.employeeId AS employeeCode, e.qatarId AS employeeQid,
  e.jobTitle AS employeeJobTitle, l.name AS locationName, l.code AS locationCode`;

const CAMEL: Record<string, string> = {
  ID: 'id', REQUESTID: 'requestId', EMPLOYEEID: 'employeeId', LOCATIONID: 'locationId', TYPE: 'type',
  STATUS: 'status', STARTDATE: 'startDate', ISSUEDATE: 'issueDate', EXPIRYDATE: 'expiryDate', ENDDATE: 'endDate',
  PASSNUMBER: 'passNumber', CARDNUMBER: 'cardNumber', PARENTPASSID: 'parentPassId',
  AUTHORITYAPPNUMBER: 'authorityAppNumber', CONTRACTNUMBER: 'contractNumber', CLIENTCOMPANY: 'clientCompany',
  REMARKS: 'remarks', HANDOVERBY: 'handoverBy', CREATEDAT: 'createdAt', UPDATEDAT: 'updatedAt',
  EMPLOYEENAME: 'employeeName', EMPLOYEECODE: 'employeeCode', EMPLOYEEQID: 'employeeQid',
  EMPLOYEEJOBTITLE: 'employeeJobTitle', LOCATIONNAME: 'locationName', LOCATIONCODE: 'locationCode',
};

export function mapPassRow(row: Record<string, any>): Record<string, any> {
  const up: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) up[k.toUpperCase()] = v;
  const out: Record<string, any> = {};
  for (const [k, name] of Object.entries(CAMEL)) out[name] = up[k] ?? null;
  let codes: unknown = [];
  try { codes = JSON.parse(up.ACCESSCODES || '[]'); } catch { codes = up.ACCESSCODES ? [String(up.ACCESSCODES)] : []; }
  out.accessCodes = Array.isArray(codes) ? codes : (codes ? [String(codes)] : []);
  out.isVirtual = Number(up.ISVIRTUAL) === 1;
  if (out.isVirtual) out.applicationId = out.requestId;
  return out;
}
