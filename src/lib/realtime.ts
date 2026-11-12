// Realtime change feed client.
// One connection per browser tab to /api/events. The server sends {"resources": [...]} naming the
// lists that changed; subscribers refetch only those. No changes => no requests.
// Authenticated by the httpOnly session cookie, which the browser sends automatically.

type ChangeListener = (resources: string[]) => void;
type StatusListener = (connected: boolean) => void;

const changeListeners = new Set<ChangeListener>();
const versionListeners = new Set<(version: string) => void>();
const statusListeners = new Set<StatusListener>();

let controller: AbortController | null = null;
let connected = false;
let everConnected = false;
let retryDelay = 2000;
let retryTimer: ReturnType<typeof setTimeout> | null = null;
let running = false;

function setConnected(value: boolean) {
  if (connected === value) return;
  connected = value;
  statusListeners.forEach(fn => fn(value));
}

function emit(resources: string[]) {
  changeListeners.forEach(fn => fn(resources));
}

function isLoggedIn(): boolean {
  try { return !!localStorage.getItem('user'); } catch { return false; }
}

async function connect() {
  if (!running) return;
  if (!isLoggedIn()) { running = false; return; }

  controller = new AbortController();
  try {
    const res = await fetch('/api/events', {
      headers: { Accept: 'text/event-stream' },
      signal: controller.signal,
      cache: 'no-store'
    });
    if (res.status === 401 || res.status === 403) { running = false; return; } // session over; normal API calls handle logout
    if (!res.ok || !res.body) throw new Error(`events ${res.status}`);

    setConnected(true);
    retryDelay = 2000;
    // Anything that changed while we were disconnected was missed: ask subscribers for a full refresh.
    if (everConnected) emit(['*']);
    everConnected = true;

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let sep: number;
      while ((sep = buffer.indexOf('\n\n')) !== -1) {
        const block = buffer.slice(0, sep);
        buffer = buffer.slice(sep + 2);
        const data = block.split('\n').filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('');
        if (!data) continue; // keep-alive comment or retry hint
        try {
          const msg = JSON.parse(data);
          if (Array.isArray(msg?.resources) && msg.resources.length > 0) emit(msg.resources);
          if (typeof msg?.version === 'string' && msg.version) versionListeners.forEach(fn => fn(msg.version));
        } catch { /* ignore malformed */ }
      }
    }
  } catch (err: any) {
    if (err?.name === 'AbortError') return;
  } finally {
    setConnected(false);
  }

  if (running) {
    retryTimer = setTimeout(connect, retryDelay);
    retryDelay = Math.min(retryDelay * 2, 60000);
  }
}

export function startRealtime() {
  if (running) return;
  running = true;
  everConnected = false;
  connect();
}

export function stopRealtime() {
  running = false;
  if (retryTimer) clearTimeout(retryTimer);
  retryTimer = null;
  controller?.abort();
  controller = null;
  setConnected(false);
}

export function onDataChanged(fn: ChangeListener): () => void {
  changeListeners.add(fn);
  return () => { changeListeners.delete(fn); };
}

export function onRealtimeStatus(fn: StatusListener): () => void {
  statusListeners.add(fn);
  return () => { statusListeners.delete(fn); };
}

// Fires with the server's deployed web-app version each time the live connection (re)opens.
export function onServerVersion(fn: (version: string) => void): () => void {
  versionListeners.add(fn);
  return () => { versionListeners.delete(fn); };
}

export function isRealtimeConnected() {
  return connected;
}
