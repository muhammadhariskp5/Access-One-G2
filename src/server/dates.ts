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
