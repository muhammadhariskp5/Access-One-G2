// Pass lifecycle is evaluated against the business calendar date (default Qatar time), not the
// server's UTC clock: a pass valid "to 12 Nov" is valid for the whole of 12 Nov local time.
export const BUSINESS_TZ = process.env.APP_TIMEZONE || 'Asia/Qatar';

export function businessToday(): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone: BUSINESS_TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  } catch {
    return new Date().toISOString().substring(0, 10);
  }
}

// YYYY-MM-DD plus n calendar days
export function addDays(ymd: string, n: number): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().substring(0, 10);
}
