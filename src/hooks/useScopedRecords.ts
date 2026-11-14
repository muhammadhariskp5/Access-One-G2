import { useCallback, useEffect, useMemo, useRef, useState, type Dispatch, type SetStateAction } from 'react';
import { apiFetch } from '../lib/utils';
import { onDataChanged } from '../lib/realtime';
import { Employee, Pass, PassApplication } from '../types';

// The records an application workspace / application form needs, loaded from POST /api/scope:
// the people involved (by ID, import identifier or picker search), the applications asked for, and
// every pass and application of those people. The screen's rules run unchanged on these arrays.
// Everything loaded is reloaded when employees, passes or applications change (live updates).
export interface ScopeRequest { applicationIds?: string[]; employeeIds?: string[]; identifiers?: string[]; q?: string }
export interface ScopeResult { employees: Employee[]; passes: Pass[]; applications: PassApplication[] }

export function useScopedRecords() {
  const [employees, setEmployees] = useState<Map<string, Employee>>(new Map());
  const [passes, setPasses] = useState<Map<string, Pass>>(new Map());
  const [applications, setApplications] = useState<Map<string, PassApplication>>(new Map());
  // What has been asked for, so a refresh can ask again
  const knownApps = useRef<Set<string>>(new Set());
  const knownEmps = useRef<Set<string>>(new Set());

  const merge = useCallback((data: ScopeResult, replace = false) => {
    const put = <T extends { id: string }>(set: Dispatch<SetStateAction<Map<string, T>>>, rows: T[]) =>
      set(prev => {
        const next = replace ? new Map<string, T>() : new Map(prev);
        rows.forEach(r => next.set(r.id, r));
        return next;
      });
    put(setEmployees, data.employees || []);
    put(setPasses, data.passes || []);
    put(setApplications, data.applications || []);
    (data.employees || []).forEach(e => knownEmps.current.add(e.id));
  }, []);

  const fetchScope = async (req: ScopeRequest): Promise<ScopeResult> => {
    const res = await apiFetch('/api/scope', { method: 'POST', body: JSON.stringify(req) });
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load records');
    return res.json();
  };

  // Load more records (merged into what is held). Returns what this request found.
  const load = useCallback(async (req: ScopeRequest): Promise<ScopeResult> => {
    (req.applicationIds || []).forEach(id => knownApps.current.add(id));
    (req.employeeIds || []).forEach(id => knownEmps.current.add(id));
    const data = await fetchScope(req);
    merge(data);
    return data;
  }, [merge]);

  // Reload everything held (after a save, or a change made elsewhere)
  const refresh = useCallback(async () => {
    if (knownApps.current.size === 0 && knownEmps.current.size === 0) return;
    try {
      const data = await fetchScope({ applicationIds: [...knownApps.current], employeeIds: [...knownEmps.current] });
      merge(data, true);
    } catch { /* keep what is shown */ }
  }, [merge]);

  useEffect(() => onDataChanged(resources => {
    if (resources.some(r => r === 'employees' || r === 'passes' || r === 'passApplications')) refresh();
  }), [refresh]);

  return {
    employees: useMemo(() => Array.from(employees.values()), [employees]),
    passes: useMemo(() => Array.from(passes.values()), [passes]),
    applications: useMemo(() => Array.from(applications.values()), [applications]),
    load,
    refresh,
  };
}

export type ScopedRecords = ReturnType<typeof useScopedRecords>;
