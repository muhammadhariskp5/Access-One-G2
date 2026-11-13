// --- Server-side application listing (Applications screen): search, stage, dates, tab, paging ---
// Each application's overall status is rolled up from its people the same way the screen did in
// the browser (utils/passStatus.ts: resolvePersonnelStatus -> calculateApplicationStats ->
// computeApplicationRollupStatus): every person on it gets a stage from their own line status and
// their latest pass on that application; the stages are counted per application, and the counts
// decide the overall status and whether it belongs under Active or History. Every input is
// whitelisted or bound.
import { STATUS_GROUPS, ymd } from './passQuery.ts';

export const APP_PAGE_SIZE_MAX = 200;
export const APP_EXPORT_MAX = 20000;

// Overall statuses that put an application under History / Archived
const CLOSED = ['archived', 'completed', 'rejected', 'cancelled', 'expired', 'replaced'];
const inList = (xs: string[]) => xs.map(s => `'${s}'`).join(', ');

export interface ApplicationListQuery {
  q: string;
  status: string;
  type: string;
  from: string | null; // YYYY-MM-DD
  to: string | null;
  sort: 'newest' | 'oldest';
  tab: 'active' | 'archived' | 'any';
  page: number;
  pageSize: number;
  all: boolean;
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
const dateParam = (v: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(str(v)) ? str(v) : null);

export function parseApplicationListQuery(query: Record<string, unknown>): ApplicationListQuery {
  const tab = str(query.tab);
  const type = str(query.type).toLowerCase();
  return {
    q: str(query.q).slice(0, 200),
    status: str(query.status).toLowerCase() || 'all',
    type: type === 'main' || type === 'supplementary' ? type : 'all',
    from: dateParam(query.from),
    to: dateParam(query.to),
    sort: str(query.sort) === 'oldest' ? 'oldest' : 'newest',
    tab: tab === 'active' || tab === 'archived' ? tab : 'any',
    page: Math.max(1, parseInt(str(query.page), 10) || 1),
    pageSize: Math.min(APP_PAGE_SIZE_MAX, Math.max(1, parseInt(str(query.pageSize), 10) || 50)),
    all: str(query.all) === '1' || str(query.all) === 'true',
  };
}

// One person's stage on an application (mirrors resolvePersonnelStatus + the buckets of
// calculateApplicationStats): x = cancelled/rejected/revoked/replaced, c = collected/active,
// i = issued, a = accepted, g = under processing, p = under review (an expired pass also lands
// here, as in the browser).
const LINE_STAGE = `CASE
    WHEN pl.es IN ('replaced', 'cancelled', 'rejected')
      OR pl.ps IN ('replaced', 'superseded', 'cancelled', 'rejected', 'revoked') THEN 'x'
    WHEN pl.ps = 'expired' THEN 'p'
    WHEN pl.ps IN ('collected', 'active') OR pl.es IN ('collected', 'completed', 'active') THEN 'c'
    WHEN pl.ps IN ('issued', 'ready_for_collection') OR pl.es IN ('issued', 'ready_for_collection') THEN 'i'
    WHEN pl.ps IN ('accepted', 'approved') OR pl.es IN ('accepted', 'approved', 'approved_for_issue') THEN 'a'
    WHEN pl.ps = 'processing' OR pl.es IN ('processing', 'under_processing', 'forwarded', 'clarification') THEN 'g'
    ELSE 'p' END`;

// Stage counts per application, over the link table and each person's latest live pass on it.
function stageCounts(orgId: string | null, binds: Record<string, unknown>): string {
  if (orgId) binds.orgId = orgId;
  const reqOrg = orgId ? ' AND r2.organizationId = :orgId' : '';
  const passOrg = orgId ? ' AND p.organizationId = :orgId' : '';
  const n = (k: string) => `SUM(CASE WHEN st.k = '${k}' THEN 1 ELSE 0 END)`;
  return `
    SELECT st.requestId AS requestId, COUNT(*) AS sTotal,
           ${n('x')} AS sX, ${n('c')} AS sC, ${n('i')} AS sI, ${n('a')} AS sA, ${n('g')} AS sG, ${n('p')} AS sP
      FROM (
        SELECT pl.requestId AS requestId, ${LINE_STAGE} AS k
          FROM (
            SELECT pre.requestId AS requestId,
                   LOWER(TRIM(COALESCE(NULLIF(TRIM(pre.status), ''), r2.status, ''))) AS es,
                   lp.ps AS ps
              FROM passRequestEmployees pre
              JOIN passRequests r2 ON r2.id = pre.requestId
              LEFT JOIN (
                SELECT p.requestId AS requestId, p.employeeId AS employeeId, LOWER(TRIM(p.status)) AS ps,
                       ROW_NUMBER() OVER (PARTITION BY p.requestId, p.employeeId ORDER BY p.createdAt DESC, p.id DESC) AS rn
                  FROM passes p
                 WHERE p.deletedAt IS NULL AND p.requestId IS NOT NULL${passOrg}
              ) lp ON lp.requestId = pre.requestId AND lp.employeeId = pre.employeeId AND lp.rn = 1
             WHERE r2.deletedAt IS NULL${reqOrg}
          ) pl
      ) st
     GROUP BY st.requestId`;
}

const T = 'COALESCE(s.sTotal, 0)';
const X = 'COALESCE(s.sX, 0)';
const C = 'COALESCE(s.sC, 0)';
const I = 'COALESCE(s.sI, 0)';
const A = 'COALESCE(s.sA, 0)';
const G = 'COALESCE(s.sG, 0)';
const P = 'COALESCE(s.sP, 0)';
const LIVE = `(${T} - ${X})`;
const RAW = `LOWER(COALESCE(r.status, ''))`;

// computeApplicationRollupStatus
const ROLLUP = `(CASE
    WHEN ${RAW} IN ('archived', 'rejected', 'cancelled', 'replaced', 'expired') THEN ${RAW}
    WHEN ${LIVE} > 0 AND ${C} = ${LIVE} THEN 'completed'
    WHEN ${LIVE} > 0 AND ${C} + ${I} = ${LIVE} THEN 'issued'
    WHEN ${LIVE} > 0 AND ${C} + ${I} > 0 THEN 'partially_issued'
    WHEN ${LIVE} > 0 AND ${A} + ${I} + ${C} = ${LIVE} THEN 'accepted'
    WHEN ${LIVE} > 0 AND (${G} > 0 OR (${A} > 0 AND ${P} > 0)) THEN 'processing'
    WHEN ${LIVE} > 0 AND ${P} = ${LIVE} THEN 'pending'
    WHEN ${LIVE} <= 0 AND ${T} > 0 AND ${X} = ${T} THEN 'cancelled'
    ELSE ${RAW} END)`;

export const ARCHIVED = `(${RAW} IN (${inList(CLOSED)}) OR ${ROLLUP} IN (${inList(CLOSED)}))`;

const START = ymd('COALESCE(r.startDate, r.createdAt)');
const END = ymd('COALESCE(r.expiryDate, r.endDate)');

// Filters shared by the count and the rows; the tab is applied separately so both tab counts
// come from one query.
export function buildApplicationList(f: ApplicationListQuery, orgId: string | null): { from: string; where: string; binds: Record<string, unknown> } {
  const binds: Record<string, unknown> = {};
  const from = `passRequests r
    LEFT JOIN (${stageCounts(orgId, binds)}) s ON s.requestId = r.id
    LEFT JOIN locations l ON l.id = r.locationId`;
  const parts: string[] = ['r.deletedAt IS NULL'];
  if (orgId) parts.push('r.organizationId = :orgId');

  if (f.q) {
    binds.q = `%${f.q.toLowerCase().replace(/[\\%_]/g, m => '\\' + m)}%`;
    const like = (c: string) => `LOWER(${c}) LIKE :q ESCAPE '\\'`;
    parts.push(`(${[like('r.id'), like('r.authorityAppNumber'), like('r.contractNumber'), like('l.name')].join(' OR ')}
      OR EXISTS (SELECT 1 FROM passRequestEmployees qe JOIN employees qm ON qm.id = qe.employeeId
                  WHERE qe.requestId = r.id AND (${like('qm.name')} OR ${like('qm.employeeId')} OR ${like('qm.qatarId')})))`);
  }

  // Stage pills match the application's own status (filterPassApplicationItem); replaced ones
  // only show under "Replaced".
  if (f.status === 'replaced') {
    parts.push(`${RAW} IN ('replaced', 'superseded')`);
  } else {
    parts.push(`${RAW} NOT IN ('replaced', 'superseded')`);
    if (f.status !== 'all') {
      const group = STATUS_GROUPS[f.status];
      if (group) parts.push(`${RAW} IN (${inList(group)})`);
      else { binds.status = f.status; parts.push(`${RAW} = :status`); }
    }
  }

  if (f.type !== 'all') { binds.type = f.type; parts.push(`COALESCE(r.type, 'main') = :type`); }

  // Date range (isPassInDateRange): valid on/after "from", and within "to"
  if (f.from) { binds.dFrom = f.from; parts.push(`NOT (${END} IS NOT NULL AND ${END} < :dFrom)`); }
  if (f.to) {
    binds.dTo = f.to;
    parts.push(`COALESCE(${START}, '1970-01-01') <= :dTo`);
    parts.push(`NOT (${END} IS NOT NULL AND ${END} > :dTo)`);
  }

  return { from, where: parts.join(' AND '), binds };
}

export function applicationTabClause(f: ApplicationListQuery): string {
  if (f.tab === 'active') return ` AND NOT ${ARCHIVED}`;
  if (f.tab === 'archived') return ` AND ${ARCHIVED}`;
  return '';
}

export function applicationOrderBy(f: ApplicationListQuery): string {
  const dir = f.sort === 'oldest' ? 'ASC' : 'DESC';
  return `ORDER BY r.createdAt ${dir}, r.id ${dir}`;
}

export const APPLICATION_LIST_COLUMNS = `r.*, ${T} AS sTotal, ${X} AS sX, ${C} AS sC, ${I} AS sI, ${A} AS sA,
  ${G} AS sG, ${P} AS sP, ${ROLLUP} AS rollupStatus, l.name AS locationName, l.code AS locationCode`;

export const APPLICATION_COUNT_COLUMNS = `COUNT(*) AS cnt, SUM(CASE WHEN ${ARCHIVED} THEN 1 ELSE 0 END) AS archivedCnt`;

const EXTRA: Record<string, string> = {
  STOTAL: 'total', SX: 'cancelledCount', SC: 'activeCollectedCount', SI: 'issuedCount', SA: 'acceptedCount',
  SG: 'processingCount', SP: 'pendingCount', ROLLUPSTATUS: 'rollupStatus', LOCATIONNAME: 'locationName', LOCATIONCODE: 'locationCode',
};

const parse = (v: unknown, fallback: unknown) => {
  if (v === null || v === undefined || v === '') return fallback;
  try { return JSON.parse(String(v)); } catch { return fallback; }
};

// Same shape as the full list (JSON fields parsed), plus the rolled-up status, the stage counts
// and the location's name.
export function mapApplicationRow(row: Record<string, any>, toCamelCase: (o: any) => any): Record<string, any> {
  const up: Record<string, any> = {};
  const base: Record<string, any> = {};
  for (const [k, v] of Object.entries(row)) {
    const K = k.toUpperCase();
    up[K] = v;
    if (!EXTRA[K]) base[k] = v;
  }
  const out = toCamelCase(base);
  const num = (k: string) => Number(up[k] ?? 0);
  out.employeeIds = parse(up.EMPLOYEEIDS, []);
  out.employeeStatuses = parse(up.EMPLOYEESTATUSES, {});
  out.temporaryNames = parse(up.TEMPORARYNAMES, []);
  out.accessCodes = parse(up.ACCESSCODES, []);
  out.individualExpiries = parse(up.INDIVIDUALEXPIRIES, {});
  out.individualStartDates = parse(up.INDIVIDUALSTARTDATES, {});
  out.rollupStatus = String(up.ROLLUPSTATUS ?? out.status ?? '').toLowerCase();
  out.locationName = up.LOCATIONNAME ?? null;
  out.locationCode = up.LOCATIONCODE ?? null;
  const cancelled = num('SX');
  out.stats = {
    activeCollectedCount: num('SC'),
    issuedCount: num('SI'),
    acceptedCount: num('SA'),
    processingCount: num('SG'),
    pendingCount: num('SP'),
    cancelledCount: cancelled,
    total: num('STOTAL'),
  };
  return out;
}
