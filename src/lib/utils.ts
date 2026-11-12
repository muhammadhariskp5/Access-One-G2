import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

// Random temporary password (12 chars) for new accounts / resets. Never use fixed defaults.
export function generateTempPassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint8Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export const formatDate = (date: string | Date | undefined | null) => {
  if (!date) return '-';
  if (typeof date === 'string') {
    const trimmed = date.trim();
    const ymd = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
    if (ymd) {
      const year = ymd[1];
      const month = ymd[2].padStart(2, '0');
      const day = ymd[3].padStart(2, '0');
      return `${day}-${month}-${year}`;
    }
    const dmy = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
    if (dmy) {
      const day = dmy[1].padStart(2, '0');
      const month = dmy[2].padStart(2, '0');
      const year = dmy[3];
      return `${day}-${month}-${year}`;
    }
  }
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  const day = d.getUTCDate().toString().padStart(2, '0');
  const month = (d.getUTCMonth() + 1).toString().padStart(2, '0');
  const year = d.getUTCFullYear();
  return `${day}-${month}-${year}`;
};

export const formatDateTime = (date: string | Date | undefined | null) => {
  if (!date) return '-';
  const d = new Date(date);
  if (isNaN(d.getTime())) return '-';
  const day = d.getDate().toString().padStart(2, '0');
  const month = (d.getMonth() + 1).toString().padStart(2, '0');
  const year = d.getFullYear();
  const hours = d.getHours().toString().padStart(2, '0');
  const minutes = d.getMinutes().toString().padStart(2, '0');
  return `${day}-${month}-${year} ${hours}:${minutes}`;
};

export const parseToYMD = (dateVal?: string | Date | null): string | null => {
  if (!dateVal) return null;
  if (dateVal instanceof Date) {
    if (isNaN(dateVal.getTime())) return null;
    const y = dateVal.getFullYear();
    const m = (dateVal.getMonth() + 1).toString().padStart(2, '0');
    const d = dateVal.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }
  const trimmed = String(dateVal).trim();
  if (!trimmed) return null;

  // Check YYYY-MM-DD or YYYY/MM/DD
  const ymd = trimmed.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
  if (ymd) {
    const y = ymd[1];
    const m = ymd[2].padStart(2, '0');
    const d = ymd[3].padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // Check DD-MM-YYYY or DD/MM/YYYY
  const dmy = trimmed.match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{4})/);
  if (dmy) {
    const d = dmy[1].padStart(2, '0');
    const m = dmy[2].padStart(2, '0');
    const y = dmy[3];
    return `${y}-${m}-${d}`;
  }

  const dt = new Date(trimmed);
  if (!isNaN(dt.getTime())) {
    const y = dt.getFullYear();
    const m = (dt.getMonth() + 1).toString().padStart(2, '0');
    const d = dt.getDate().toString().padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  return null;
};

export const isPassInDateRange = (
  p: { startDate?: string; issueDate?: string; expiryDate?: string; endDate?: string; createdAt?: string },
  start?: string,
  end?: string
) => {
  if (!start && !end) return true;

  const filterStart = parseToYMD(start);
  const filterEnd = parseToYMD(end);

  const rawStart = p.startDate || p.issueDate || p.createdAt;
  const rawEnd = p.expiryDate || p.endDate;

  const pStart = parseToYMD(rawStart) || '1970-01-01';
  const pEnd = parseToYMD(rawEnd);

  if (filterStart) {
    // "start date means pass is valid in/from this date"
    if (pEnd && pEnd < filterStart) {
      return false;
    }
  }

  if (filterEnd) {
    // "end Date pass is valid till this date (dont show above this date)"
    if (pStart > filterEnd) {
      return false;
    }
    if (pEnd && pEnd > filterEnd) {
      return false;
    }
  }

  return true;
};

// The session lives in an httpOnly cookie set by the server at login; the browser sends it
// automatically. X-Requested-With is the CSRF guard the server requires on writes.
export const apiFetch = async (url: string, options: any = {}) => {
  const headers = {
    'Content-Type': 'application/json',
    'X-Requested-With': 'AccessOne',
    ...options.headers
  };
  
  const maxRetries = options.retries ?? 2;
  let attempt = 0;
  let lastErr: any = null;

  while (attempt <= maxRetries) {
    try {
      const res = await fetch(url, { ...options, headers });
      const contentType = res.headers.get('content-type') || '';
      
      if (!res.ok) {
    if (res.status === 401) {
      const hadUser = !!localStorage.getItem('user');
      try { localStorage.removeItem('user'); } catch (e) { /* ignore */ }
      if (hadUser && typeof window !== 'undefined' && window.location.pathname !== '/' && !(window as any).__accessOneSessionExpiredRedirect) {
        (window as any).__accessOneSessionExpiredRedirect = true;
        window.location.href = '/';
      }
      throw new Error('Session expired. Please log in again.');
    }
        const clonedRes = res.clone();
        let errorMsg = `Request failed with status ${res.status}`;
        try {
          if (contentType.includes('application/json')) {
            const errorData = await clonedRes.json();
            errorMsg = errorData?.error || errorData?.message || errorMsg;
          } else {
            const text = await clonedRes.text();
            if (text.trim().startsWith('<!doctype') || text.trim().startsWith('<html')) {
              errorMsg = `Server returned HTML (${res.status}) for ${url}. The server may be restarting.`;
            }
          }
        } catch (e) {
          // Fallback to generic status error
        }
        throw new Error(errorMsg);
      }

      if (contentType.includes('application/json')) {
        return res;
      }
      
      // For non-JSON ok responses, inspect cloned text to prevent consuming the main response body
      const cloned = res.clone();
      const text = await cloned.text();
      if (text.trim().startsWith('<!doctype') || text.trim().startsWith('<html')) {
        throw new Error(`Expected JSON response from ${url} but received HTML.`);
      }
      
      return res;
    } catch (err: any) {
      lastErr = err;
      if (err?.name === 'AbortError') {
        throw err;
      }
      const isNetworkError = err?.name === 'TypeError' && (err?.message?.includes('fetch') || err?.message?.includes('network') || err?.message?.includes('Failed to fetch'));
      
      // Retry transient network drops or proxy reconnections
      if (isNetworkError && attempt < maxRetries) {
        attempt++;
        const delay = attempt * 500;
        await new Promise(r => setTimeout(r, delay));
        continue;
      }

      if (err?.message?.includes('status 500') || !err?.message) {
        console.error(`apiFetch error for ${url}:`, err);
      } else {
        console.warn(`apiFetch warning for ${url}:`, err.message);
      }

      if (isNetworkError) {
        throw new Error(`Server connection error: Unable to communicate with the service (${err.message}). Please verify connection and retry.`);
      }
      throw err;
    }
  }

  throw lastErr || new Error(`Request failed after ${maxRetries} attempts.`);
};
