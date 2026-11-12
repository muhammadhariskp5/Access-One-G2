// --- Brute-force protection for authentication endpoints ---
// Fixed-window counters in memory (single process). Two keys per request: client IP and the
// target email, so one attacker can't hammer many accounts and many IPs can't hammer one account.
const authAttempts = new Map<string, { count: number; resetAt: number }>();
const AUTH_WINDOW_MS = 15 * 60 * 1000;
setInterval(() => {
  const now = Date.now();
  for (const [k, v] of authAttempts) if (v.resetAt <= now) authAttempts.delete(k);
}, AUTH_WINDOW_MS).unref();

export function authRateLimit(maxPerIp: number, maxPerEmail: number) {
  return (req: any, res: any, next: any) => {
    const now = Date.now();
    const email = String(req.body?.email || '').trim().toLowerCase();
    const keys: [string, number][] = [[`${req.path}|ip|${req.ip}`, maxPerIp]];
    if (email) keys.push([`${req.path}|email|${email}`, maxPerEmail]);
    for (const [key, max] of keys) {
      let entry = authAttempts.get(key);
      if (!entry || entry.resetAt <= now) { entry = { count: 0, resetAt: now + AUTH_WINDOW_MS }; authAttempts.set(key, entry); }
      entry.count++;
      if (entry.count > max) {
        res.setHeader('Retry-After', String(Math.ceil((entry.resetAt - now) / 1000)));
        return res.status(429).json({ error: "Too many attempts. Please wait a few minutes and try again." });
      }
    }
    next();
  };
}
