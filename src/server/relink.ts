// --- Re-link passes and applications that name a person by code / QID instead of their ID ---
// Older records sometimes stored an employee's staff code, QID or visa number where the employee's
// ID belongs. The old screens matched those loosely in the browser; the server matches by ID (and
// a foreign key will enforce that), so such records must point at the real ID. A reference is
// re-linked only when exactly one employee of the same organization matches it; anything else is
// left as is and counted.
import { logger } from './log.ts';
import { loadPeople, savePeople } from './requestLinks.ts';

const key = (v: unknown) => String(v ?? '').trim().toLowerCase();

export async function relinkEmployeeReferences(conn: any): Promise<{ passes: number; applications: number; unresolved: number }> {
  const oracledb = (await import('oracledb')).default;
  const opts = { outFormat: oracledb.OUT_FORMAT_OBJECT };
  const g = (r: any, k: string) => r[k.toUpperCase()] ?? r[k] ?? null;

  // Every way an employee can be named -> candidate employees
  const empRes = await conn.execute(
    `SELECT id, employeeId, qatarId, qidVisaNumber, visaNumber, organizationId, deletedAt FROM employees`, {}, opts);
  const ids = new Set<string>();
  const byName = new Map<string, { id: string; org: string | null; live: boolean }[]>();
  for (const e of (empRes.rows || []) as any[]) {
    const id = String(g(e, 'id'));
    ids.add(id);
    const entry = { id, org: g(e, 'organizationId'), live: !g(e, 'deletedAt') };
    for (const v of new Set([id, g(e, 'employeeId'), g(e, 'qatarId'), g(e, 'qidVisaNumber'), g(e, 'visaNumber')].map(key).filter(Boolean))) {
      const list = byName.get(v) || [];
      list.push(entry);
      byName.set(v, list);
    }
  }
  const resolve = (ref: unknown, org: string | null): string | null => {
    let c = byName.get(key(ref)) || [];
    if (org) c = c.filter(x => !x.org || x.org === org);
    if (c.length > 1) c = c.filter(x => x.live);   // prefer the live record
    return c.length === 1 ? c[0].id : null;
  };

  let passes = 0, applications = 0, unresolved = 0;

  // 1. Passes whose employeeId is not an employee ID
  const pRes = await conn.execute(
    `SELECT p.id, p.employeeId, p.organizationId FROM passes p
      WHERE p.employeeId IS NOT NULL AND NOT EXISTS (SELECT 1 FROM employees e WHERE e.id = p.employeeId)`, {}, opts);
  for (const p of (pRes.rows || []) as any[]) {
    const target = resolve(g(p, 'employeeId'), g(p, 'organizationId'));
    if (!target) { unresolved++; continue; }
    await conn.execute(`UPDATE passes SET employeeId = :emp WHERE id = :id`, { emp: target, id: g(p, 'id') });
    passes++;
  }

  // 2. Applications whose original people list named someone by code / QID: add them to the link
  //    table (they were left out when it was built, as no employee had that ID)
  const aRes = await conn.execute(
    `SELECT id, organizationId, employeeIds, employeeStatuses, individualExpiries, individualStartDates FROM passRequests WHERE deletedAt IS NULL`, {}, opts);
  const parse = (v: unknown, f: any) => { try { return v ? JSON.parse(String(v)) : f; } catch { return f; } };
  for (const a of (aRes.rows || []) as any[]) {
    const jsonIds: string[] = (parse(g(a, 'employeeIds'), []) || []).map(String);
    const strays = jsonIds.filter(id => id && !ids.has(id));
    if (strays.length === 0) continue;
    const appId = String(g(a, 'id'));
    const people = await loadPeople(conn, appId);
    const statuses = parse(g(a, 'employeeStatuses'), {}) || {};
    const exps = parse(g(a, 'individualExpiries'), {}) || {};
    const starts = parse(g(a, 'individualStartDates'), {}) || {};
    let changed = false;
    for (const ref of strays) {
      const target = resolve(ref, g(a, 'organizationId'));
      if (!target) { unresolved++; continue; }
      if (people.employeeIds.includes(target)) continue;
      people.employeeIds = [...people.employeeIds, target];
      if (statuses[ref]) people.employeeStatuses = { ...people.employeeStatuses, [target]: statuses[ref] };
      if (exps[ref]) people.individualExpiries = { ...people.individualExpiries, [target]: exps[ref] };
      if (starts[ref]) people.individualStartDates = { ...people.individualStartDates, [target]: starts[ref] };
      changed = true;
    }
    if (changed) { await savePeople(conn, appId, people); applications++; }
  }

  logger.info('[Relink] employee references re-linked', { passes, applications, unresolved });
  return { passes, applications, unresolved };
}
