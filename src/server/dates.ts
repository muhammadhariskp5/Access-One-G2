// --- Dates: one stored format (YYYY-MM-DD) ---
// Day-first (DD/MM/YYYY), ISO, one-digit day/month, Excel serials and written-out dates are all
// read; invalid calendar dates (31/02, month 13) give null.
export function normalizeDate(d: any): string | null {
  if (d === null || d === undefined || d === '') return null;
  // Real calendar date check (rejects 31/02, month 13, ...)
  const valid = (y: number, m: number, day: number) => {
    const t = new Date(Date.UTC(y, m - 1, day));
    return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === day;
  };
  // Excel stores dates as serial day numbers (1 = 1900-01-01, epoch 1899-12-30)
  const serial = typeof d === 'number' ? d : (/^\d{5}(\.\d+)?$/.test(String(d).trim()) ? Number(String(d).trim()) : NaN);
  if (Number.isFinite(serial) && serial > 20000 && serial < 80000) {
    const t = new Date(Date.UTC(1899, 11, 30) + Math.floor(serial) * 86400000);
    return t.toISOString().substring(0, 10);
  }
  if (d instanceof Date) {
    if (isNaN(d.getTime())) return null;
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  const str = String(d).trim();
  if (!str) return null;

  const ymdMatch = str.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})/);
  if (ymdMatch) {
    if (!valid(+ymdMatch[1], +ymdMatch[2], +ymdMatch[3])) return null;
    return `${ymdMatch[1]}-${ymdMatch[2].padStart(2, '0')}-${ymdMatch[3].padStart(2, '0')}`;
  }

  // Day-first (DD/MM/YYYY), the local convention
  const dmyMatch = str.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})/);
  if (dmyMatch) {
    if (!valid(+dmyMatch[3], +dmyMatch[2], +dmyMatch[1])) return null;
    return `${dmyMatch[3]}-${dmyMatch[2].padStart(2, '0')}-${dmyMatch[1].padStart(2, '0')}`;
  }

  const parsed = new Date(str);
  if (!isNaN(parsed.getTime())) {
    const y = parsed.getFullYear();
    const m = String(parsed.getMonth() + 1).padStart(2, '0');
    const day = String(parsed.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }
  return null;
}

// Stored pass / application dates that are not yet YYYY-MM-DD, converted in place. SQL rules (Access
// Matrix, pass list, dashboard) compare these dates as text, so they must all share one format.
// Values that can't be read are left untouched. Returns how many were converted.
const DATE_COLUMNS: [string, string[]][] = [
  ['passes', ['startDate', 'expiryDate', 'endDate']],
  ['passRequests', ['startDate', 'endDate', 'expiryDate']],
  ['passRequestEmployees', ['startDate', 'expiryDate']],
];

export async function normalizeStoredDates(connection: any): Promise<number> {
  const oracledb = (await import("oracledb")).default;
  const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  let changed = 0;
  for (const [table, cols] of DATE_COLUMNS) {
    for (const col of cols) {
      const res = await connection.execute(
        `SELECT id, ${col} AS v FROM ${table} WHERE ${col} IS NOT NULL AND ${col} NOT LIKE '____-__-__%'`, {}, opts
      );
      for (const row of (res.rows || []) as any[]) {
        const raw = row.V ?? row.v;
        const fixed = normalizeDate(raw);
        if (fixed && fixed !== String(raw).trim()) {
          await connection.execute(`UPDATE ${table} SET ${col} = :v WHERE id = :id`, { v: fixed, id: row.ID ?? row.id });
          changed++;
        }
      }
    }
  }
  return changed;
}

// Employee document dates that an old import saved wrongly: an Excel date number (e.g. 46261 =
// 2026-08-27) stored as if it were the year ("46261-12-31", shown as 31-12-46261), or any other
// non YYYY-MM-DD / impossible value. Readable ones are converted; anything else is cleared only
// when it cannot be a date at all (year outside 1900-2200), so the edit form can save again.
// Returns { fixed, cleared }.
const EMPLOYEE_DATE_COLUMNS = ['passportExpiry', 'visaExpiry', 'qidVisaExpiry', 'safetyInductionDate'];
const plausible = (ymd: string | null) => !!ymd && /^\d{4}-\d{2}-\d{2}$/.test(ymd) && +ymd.slice(0, 4) >= 1900 && +ymd.slice(0, 4) <= 2200;

export function repairDateValue(raw: unknown): { value: string | null; changed: boolean } {
  const s = String(raw ?? '').trim();
  if (!s) return { value: null, changed: false };
  if (plausible(s.slice(0, 10)) && /^\d{4}-\d{2}-\d{2}$/.test(s.slice(0, 10))) return { value: s, changed: false };
  // An Excel serial number inside the value (5 digits, 20000-80000 = years 1954-2119)
  const serial = s.match(/(?:^|\D)0*([2-7]\d{4})(?:\D|$)/);
  if (serial) {
    const fixed = normalizeDate(Number(serial[1]));
    if (plausible(fixed)) return { value: fixed, changed: true };
  }
  const fixed = normalizeDate(s);
  if (plausible(fixed)) return { value: fixed, changed: fixed !== s };
  return { value: null, changed: true };    // cannot be a date: clear it
}

export async function repairEmployeeDates(connection: any): Promise<{ fixed: number; cleared: number }> {
  const oracledb = (await import("oracledb")).default;
  const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  let fixed = 0, cleared = 0;
  for (const col of EMPLOYEE_DATE_COLUMNS) {
    let res;
    try {
      res = await connection.execute(
        `SELECT id, ${col} AS v FROM employees WHERE ${col} IS NOT NULL AND NOT (${col} LIKE '19__-__-__%' OR ${col} LIKE '20__-__-__%' OR ${col} LIKE '21__-__-__%')`, {}, opts);
    } catch { continue; }   // column not present in this database
    for (const row of (res.rows || []) as any[]) {
      const r = repairDateValue(row.V ?? row.v);
      if (!r.changed) continue;
      await connection.execute(`UPDATE employees SET ${col} = :v WHERE id = :id`, { v: r.value, id: row.ID ?? row.id });
      if (r.value) fixed++; else cleared++;
    }
  }
  return { fixed, cleared };
}
