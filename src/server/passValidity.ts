// --- Is a pass valid? Its status AND its date decide ---
// The stored status records decisions (issued, collected/active, cancelled, revoked, replaced).
// Expiry is never a decision: a live pass whose expiry date has passed is "expired" - worked out
// when it is read, never written by a job or by hand. A decision (cancelled, revoked, replaced)
// ends a pass whatever its date says.
// Passes stored as 'expired' by older versions stay expired (all of them are past their date).
import { ymd } from './passQuery.ts';
import { normalizeDate } from './dates.ts';
import { businessToday } from './businessDate.ts';

export const LIVE_PASS_STATUSES = ['active', 'collected', 'completed', 'received'];
const liveIn = `(${LIVE_PASS_STATUSES.map(s => `'${s}'`).join(', ')})`;
// Decisions that end a pass whatever its date says; 'expired' is kept for passes older versions marked
export const ENDED_PASS_STATUSES = ['expired', 'revoked', 'cancelled', 'replaced', 'superseded', 'inactive', 'rejected', 'deleted', 'archived'];
const endedIn = `(${ENDED_PASS_STATUSES.map(s => `'${s}'`).join(', ')})`;

// SQL: the pass's status as of :today (bind it) - 'expired' for any pass not ended by a decision
// (issued, collected, active, ...) whose expiry date has passed
export const effectiveStatusSql = (alias: string, today = ':today') =>
  `(CASE WHEN LOWER(TRIM(COALESCE(${alias}.status, '~'))) NOT IN ${endedIn}
          AND ${ymd(`${alias}.expiryDate`)} IS NOT NULL AND ${ymd(`${alias}.expiryDate`)} < ${today}
         THEN 'expired' ELSE ${alias}.status END)`;

// SQL: a live status and not past its expiry date
export const isValidPassSql = (alias: string, today = ':today') =>
  `(LOWER(TRIM(COALESCE(${alias}.status, '~'))) IN ${liveIn}
    AND NOT (${ymd(`${alias}.expiryDate`)} IS NOT NULL AND ${ymd(`${alias}.expiryDate`)} < ${today}))`;

export function effectiveStatus(status: unknown, expiryDate: unknown, today = businessToday()): string {
  const s = String(status ?? '');
  const exp = normalizeDate(expiryDate as any);
  return !ENDED_PASS_STATUSES.includes(s.trim().toLowerCase()) && !!exp && exp < today ? 'expired' : s;
}

// A pass object as sent to the browser: status as of today
export function withEffectiveStatus<T extends Record<string, any>>(p: T, today = businessToday()): T {
  if (!p || typeof p !== 'object') return p;
  return { ...p, status: effectiveStatus(p.status, p.expiryDate, today) };
}
