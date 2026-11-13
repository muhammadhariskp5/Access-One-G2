import { useCallback, useEffect, useRef, useState } from 'react';
import { Employee } from '../types';
import { apiFetch } from '../lib/utils';
import { onDataChanged } from '../lib/realtime';

// Server-side paged employee list: the database filters, sorts and pages; the page holds only
// the rows loaded so far (infinite scroll), not every employee.
export interface EmployeeListParams {
  q: string;
  type: string;
  status: string;
  division: string;
  department: string;
  project: string;
  duplicates: boolean;
  sort: string;
  order: 'asc' | 'desc';
}

export type ListedEmployee = Employee & { duplicateReasons?: string[] };

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200; // server cap

function toQuery(p: EmployeeListParams, extra: Record<string, string | number>): string {
  const qs = new URLSearchParams();
  if (p.q.trim()) qs.set('q', p.q.trim());
  for (const k of ['type', 'status', 'division', 'department', 'project'] as const) {
    if (p[k] && p[k] !== 'all') qs.set(k, p[k]);
  }
  if (p.duplicates) qs.set('duplicates', '1');
  qs.set('sort', p.sort);
  qs.set('order', p.order);
  for (const [k, v] of Object.entries(extra)) qs.set(k, String(v));
  return qs.toString();
}

async function fetchPage(p: EmployeeListParams, extra: Record<string, string | number>) {
  const res = await apiFetch(`/api/employees?${toQuery(p, extra)}`);
  if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load employees');
  return res.json() as Promise<{ items: ListedEmployee[]; total: number; page: number; pageSize: number; duplicateCount: number }>;
}

export function useEmployeeList(params: EmployeeListParams) {
  const [items, setItems] = useState<ListedEmployee[]>([]);
  const [total, setTotal] = useState(0);
  const [duplicateCount, setDuplicateCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seq = useRef(0);           // ignores responses that arrive after a newer request
  const pageRef = useRef(1);
  const countRef = useRef(0);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const key = JSON.stringify(params);

  // Reload the rows currently loaded (after an edit, delete, or a change made by someone else).
  const reload = useCallback(async () => {
    const mySeq = ++seq.current;
    const size = Math.min(MAX_PAGE_SIZE, Math.max(PAGE_SIZE, countRef.current));
    try {
      const data = await fetchPage(paramsRef.current, { page: 1, pageSize: size });
      if (mySeq !== seq.current) return;
      setItems(data.items);
      setTotal(data.total);
      setDuplicateCount(data.duplicateCount);
      countRef.current = data.items.length;
      pageRef.current = Math.max(1, Math.ceil(data.items.length / PAGE_SIZE));
      setError(null);
    } catch (e: any) {
      if (mySeq === seq.current) setError(e.message);
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, []);

  // New filters / search / sort: start again from page 1 (debounced while typing).
  useEffect(() => {
    setLoading(true);
    countRef.current = 0;
    const t = setTimeout(() => { reload(); }, 250);
    return () => clearTimeout(t);
  }, [key, reload]);

  const loadMore = useCallback(async () => {
    if (loadingMore || loading || countRef.current >= total) return;
    const mySeq = seq.current;
    setLoadingMore(true);
    try {
      const next = pageRef.current + 1;
      const data = await fetchPage(paramsRef.current, { page: next, pageSize: PAGE_SIZE });
      if (mySeq !== seq.current) return;
      setItems(prev => {
        const seen = new Set(prev.map(e => e.id));
        const merged = [...prev, ...data.items.filter(e => !seen.has(e.id))];
        countRef.current = merged.length;
        return merged;
      });
      setTotal(data.total);
      pageRef.current = next;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoadingMore(false);
    }
  }, [loading, loadingMore, total]);

  // Someone (here or elsewhere) changed employees: refresh what's on screen.
  useEffect(() => onDataChanged(resources => {
    if (resources.includes('employees')) reload();
  }), [reload]);

  // Every matching row (capped server-side), for export and print.
  const fetchAll = useCallback(async (): Promise<ListedEmployee[]> => {
    const data = await fetchPage(paramsRef.current, { all: 1 });
    return data.items;
  }, []);

  return { items, total, duplicateCount, loading, loadingMore, error, hasMore: items.length < total, loadMore, reload, fetchAll };
}
