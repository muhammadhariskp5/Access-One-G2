// --- Realtime change feed (Server-Sent Events) ---
// Instead of every browser re-downloading every table on a timer, the server tells connected
// browsers *which* lists changed and they refetch only those. No changes => no traffic.
// Single-process in-memory hub (pm2 runs one instance). If the app is ever scaled to several
// processes, replace this with a shared pub/sub (e.g. Redis) — the client protocol stays the same.
export type RealtimeClient = { res: any; userId: string; orgId: string; isPowerAdmin: boolean };
export const realtimeClients = new Set<RealtimeClient>();
export const pendingNotificationUsers = new Set<string>();

export function sendRealtime(client: RealtimeClient, resources: string[]) {
  try { client.res.write(`data: ${JSON.stringify({ resources })}\n\n`); } catch { realtimeClients.delete(client); }
}

// Tell every client that can see `orgId` (null = platform-wide) that these lists changed.
export function publishChange(resources: string[], orgId?: string | null) {
  if (resources.length === 0 || realtimeClients.size === 0) return;
  for (const c of realtimeClients) {
    if (!orgId || c.isPowerAdmin || c.orgId === orgId) sendRealtime(c, resources);
  }
}

// Notifications are per user; createNotification() queues the recipient and the queue is
// flushed once the surrounding work has committed (end of request / end of background job).
export function flushNotificationPushes() {
  if (pendingNotificationUsers.size === 0) return;
  const users = new Set(pendingNotificationUsers);
  pendingNotificationUsers.clear();
  for (const c of realtimeClients) {
    if (users.has(c.userId)) sendRealtime(c, ['notifications']);
  }
}

// Which client lists a successful write to /api/<group> can affect.
export const REALTIME_RESOURCE_MAP: Record<string, string[]> = {
  employees: ['employees', 'passes', 'passApplications'],
  passes: ['passes', 'passApplications'],
  passApplications: ['passApplications', 'passes'],
  locations: ['locations', 'passes'],
  categories: ['categories', 'locations'],
  accessCodes: ['accessCodes'],
  divisions: ['divisions'],
  projects: ['projects'],
  departments: ['departments'],
  users: ['users'],
  settings: ['company'],
  platform: ['company', 'users'],
};
