import crypto from 'crypto';

// --- Identifiers ---
// Row IDs: random UUIDs (collision-free, unguessable).
export function newId(): string {
  return crypto.randomUUID();
}
// Human-facing references (application IDs people read out / type): short, uppercase,
// no look-alike characters, from a cryptographic source. 31^10 ≈ 8e14 combinations.
const REF_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
export function newRef(length = 10): string {
  const bytes = crypto.randomBytes(length);
  let out = '';
  for (let i = 0; i < length; i++) out += REF_ALPHABET[bytes[i] % REF_ALPHABET.length];
  return out;
}

// --- Sequential document numbers (pass numbers, direct-entry application numbers) ---
// A counter row per series (e.g. "PASS-2026") is incremented inside the caller's transaction;
// the row lock serialises concurrent issuers, so numbers are unique and gap-free per commit.
// A new series starts above the highest number already issued, so pre-existing numbers
// (from the old random scheme) are never reused.
export async function highestIssuedInSeries(connection: any, series: string): Promise<number> {
  const oracledb = (await import("oracledb")).default;
  const like = `${series}-%`;
  const queries = series.startsWith('DE-')
    ? [`SELECT authorityAppNumber AS num FROM passRequests WHERE authorityAppNumber LIKE :p`,
       `SELECT authorityAppNumber AS num FROM passes WHERE authorityAppNumber LIKE :p`]
    : [`SELECT passNumber AS num FROM passes WHERE passNumber LIKE :p`];
  let max = 0;
  for (const sql of queries) {
    const r = await connection.execute(sql, { p: like }, { outFormat: oracledb.OUT_FORMAT_OBJECT });
    for (const row of (r.rows || []) as any[]) {
      const n = parseInt(String(row.NUM ?? row.num ?? '').slice(series.length + 1), 10);
      if (Number.isFinite(n) && n > max) max = n;
    }
  }
  return max;
}

export async function nextSequenceValue(connection: any, series: string, pad = 4): Promise<string> {
  const oracledb = (await import("oracledb")).default;
  for (let attempt = 0; attempt < 3; attempt++) {
    const upd = await connection.execute(
      `UPDATE sequenceCounters SET currentValue = currentValue + 1 WHERE seqKey = :k`,
      { k: series }
    );
    if ((upd.rowsAffected || 0) > 0) {
      const r = await connection.execute(
        `SELECT currentValue FROM sequenceCounters WHERE seqKey = :k`,
        { k: series },
        { outFormat: oracledb.OUT_FORMAT_OBJECT }
      );
      const row: any = r.rows?.[0];
      return String(Number(row?.CURRENTVALUE ?? row?.currentValue)).padStart(pad, '0');
    }
    // First number in this series
    const start = (await highestIssuedInSeries(connection, series)) + 1;
    try {
      await connection.execute(
        `INSERT INTO sequenceCounters (seqKey, currentValue) VALUES (:k, :v)`,
        { k: series, v: start }
      );
      return String(start).padStart(pad, '0');
    } catch {
      // Another request created the series at the same moment; loop and increment it.
    }
  }
  throw new Error(`Could not allocate a number in series ${series}`);
}
