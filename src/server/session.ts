import crypto from 'crypto';
import { debugLog } from './log.ts';

// --- Signed Session Token Helpers (added by security audit fix) ---
// Client identity must never be trusted directly from request headers; it must come from
// a token that was signed by this server at login time and verified on every request.
export const SESSION_SECRET = process.env.SESSION_SECRET || (() => {
  debugLog('WARNING: SESSION_SECRET env var not set. Using an ephemeral secret for this process only; all sessions will be invalidated on restart. Set SESSION_SECRET in your environment for production use.');
  return crypto.randomBytes(32).toString('hex');
})();

export function signSessionToken(payload: Record<string, any>) {
  const body = Buffer.from(JSON.stringify({ ...payload, exp: Date.now() + 24 * 60 * 60 * 1000 })).toString('base64url');
  const sig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
  return body + '.' + sig;
}

export function verifySessionToken(token: string): any {
  try {
    const parts = token.split('.');
    if (parts.length !== 2) return null;
    const [body, sig] = parts;
    const expectedSig = crypto.createHmac('sha256', SESSION_SECRET).update(body).digest('base64url');
    const sigBuf = Buffer.from(sig);
    const expBuf = Buffer.from(expectedSig);
    if (sigBuf.length !== expBuf.length || !crypto.timingSafeEqual(sigBuf, expBuf)) return null;
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload.exp || Date.now() > payload.exp) return null;
    return payload;
  } catch (e) {
    return null;
  }
}


// --- Session cookie ---
// The signed session token lives in an httpOnly cookie, so page scripts (and any injected
// script) cannot read it. SameSite=Lax + a required custom header on writes blocks CSRF.
export const SESSION_COOKIE = 'ao_session';
export const SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000;

export function readCookie(req: any, name: string): string {
  const header = String(req.headers?.cookie || '');
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx > -1 && part.slice(0, idx).trim() === name) {
      try { return decodeURIComponent(part.slice(idx + 1).trim()); } catch { return ''; }
    }
  }
  return '';
}

export function setSessionCookie(res: any, token: string) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === 'production',
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_MS
  });
}

export function clearSessionCookie(res: any) {
  res.clearCookie(SESSION_COOKIE, { httpOnly: true, secure: process.env.NODE_ENV === 'production', sameSite: 'lax', path: '/' });
}

// Session token from the cookie (browser) or a Bearer header (API clients / scripts).
export function getSessionToken(req: any): string {
  const authHeader = String(req.headers?.['authorization'] || '');
  if (authHeader.startsWith('Bearer ')) return authHeader.slice(7).trim();
  return readCookie(req, SESSION_COOKIE);
}
