import { useCallback, useEffect, useRef, useState } from 'react';
import { apiFetch } from '../lib/utils';
import { onDataChanged } from '../lib/realtime';

// Server-side paged list: the database filters, sorts and pages; the screen holds only the rows
// loaded so far (infinite scroll). Used by Employees and Pass Status Management.
export interface PagedResponse<T> { items: T[]; total: number; page: number; pageSize: number; [extra: string]: unknown }

const PAGE_SIZE = 50;
const MAX_PAGE_SIZE = 200; // server cap

function toQuery(params: Record<string, string | number | boolean | null | undefined>, extra: Record<string, string | number>): string {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === false) continue;
    const s = v === true ? '1' : String(v).trim();
    if (s === '' || s === 'all') continue;
    qs.set(k, s);
  }
  for (const [k, v] of Object.entries(extra)) qs.set(k, String(v));
  return qs.toString();
}

export function usePagedList<T extends { id: string }>(
  endpoint: string,
  params: Record<string, string | number | boolean | null | undefined>,
  realtimeResources: string[],
  pageSize: number = PAGE_SIZE,
) {
  const step = Math.min(MAX_PAGE_SIZE, Math.max(1, pageSize));
  const [items, setItems] = useState<T[]>([]);
  const [total, setTotal] = useState(0);
  const [extra, setExtra] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const seq = useRef(0);           // ignores responses that arrive after a newer request
  const pageRef = useRef(1);
  const countRef = useRef(0);
  const paramsRef = useRef(params);
  paramsRef.current = params;
  const key = JSON.stringify(params);
  const resourcesKey = realtimeResources.join(',');

  const fetchPage = useCallback(async (extraQs: Record<string, string | number>): Promise<PagedResponse<T>> => {
    const res = await apiFetch(`${endpoint}?${toQuery(paramsRef.current, extraQs)}`);
    if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Failed to load list');
    return res.json();
  }, [endpoint]);

  // Reload the rows currently loaded (after an edit, or a change made by someone else).
  const reload = useCallback(async () => {
    const mySeq = ++seq.current;
    const size = Math.min(MAX_PAGE_SIZE, Math.max(step, countRef.current));
    try {
      const { items: rows, total: t, page: _p, pageSize: _s, ...rest } = await fetchPage({ page: 1, pageSize: size });
      if (mySeq !== seq.current) return;
      setItems(rows);
      setTotal(t);
      setExtra(rest);
      countRef.current = rows.length;
      pageRef.current = Math.max(1, Math.ceil(rows.length / step));
      setError(null);
    } catch (e: any) {
      if (mySeq === seq.current) setError(e.message);
    } finally {
      if (mySeq === seq.current) setLoading(false);
    }
  }, [fetchPage, step]);

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
      const data = await fetchPage({ page: next, pageSize: step });
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
  }, [loading, loadingMore, total, fetchPage, step]);

  // Someone (here or elsewhere) changed the data: refresh what's on screen.
  useEffect(() => onDataChanged(resources => {
    if (resources.some(r => realtimeResources.includes(r))) reload();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [reload, resourcesKey]);

  // Every matching row (capped server-side), for export and print.
  const fetchAll = useCallback(async (): Promise<T[]> => (await fetchPage({ all: 1 })).items, [fetchPage]);

  return { items, total, extra, loading, loadingMore, error, hasMore: items.length < total, loadMore, reload, fetchAll };
}
