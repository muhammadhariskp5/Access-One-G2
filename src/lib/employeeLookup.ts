import { apiFetch } from './utils';

// Which of these identifiers (employee codes, QID/visa numbers, passport numbers) already belong to
// a live employee. Asked of the server so the browser needn't hold the whole employee list.
export interface IdLookup { employeeId: string[]; document: string[]; passport: string[] }

export async function lookupEmployeeIds(values: string[], excludeId?: string): Promise<IdLookup> {
  const empty: IdLookup = { employeeId: [], document: [], passport: [] };
  const list = Array.from(new Set(values.map(v => String(v ?? '').trim()).filter(Boolean)));
  if (list.length === 0) return empty;
  try {
    const res = await apiFetch('/api/employees/lookup-ids', {
      method: 'POST',
      body: JSON.stringify({ values: list, excludeId }),
    });
    if (!res.ok) return empty;
    const body = await res.json();
    return { employeeId: body.employeeId || [], document: body.document || [], passport: body.passport || [] };
  } catch {
    return empty; // the server still rejects duplicates on save
  }
}
