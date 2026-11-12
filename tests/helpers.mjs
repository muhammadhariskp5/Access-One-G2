// Test harness: starts the real server against a throwaway SQLite file on its own port.
import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
let nextPort = 3100 + Math.floor(Math.random() * 500);

export const OWNER = { email: 'owner@test.local', password: 'BootstrapPass123' };

export function tempDbPath() {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'accessone-test-')), 'test.sqlite');
}

export async function startServer({ dbPath = tempDbPath(), env = {} } = {}) {
  const port = nextPort++;
  const child = spawn(process.execPath, ['--import', 'tsx', 'server.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      NODE_ENV: 'test',
      PORT: String(port),
      SQLITE_PATH: dbPath,
      SESSION_SECRET: 'test-secret',
      BOOTSTRAP_ADMIN_EMAIL: OWNER.email,
      BOOTSTRAP_ADMIN_PASSWORD: OWNER.password,
      ...env
    },
    stdio: ['ignore', 'pipe', 'pipe']
  });
  let output = '';
  child.stdout.on('data', d => { output += d; });
  child.stderr.on('data', d => { output += d; });

  const base = `http://127.0.0.1:${port}`;
  const deadline = Date.now() + 90_000;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server exited early:\n${output}`);
    try {
      const r = await fetch(`${base}/api/health`);
      if (r.ok && (await r.json()).ready) break;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) { child.kill(); throw new Error(`server not ready in time:\n${output}`); }
    await new Promise(r => setTimeout(r, 300));
  }

  return {
    base,
    dbPath,
    output: () => output,
    async stop() {
      // SQLite saves are debounced (150 ms) and atomic; on Windows a child cannot receive a
      // catchable SIGINT, so give the last save time to land before stopping the process.
      await new Promise(r => setTimeout(r, 600));
      child.kill('SIGINT');
      await new Promise(r => child.once('exit', r));
      await new Promise(r => setTimeout(r, 300)); // let the SQLite file flush
    }
  };
}

// Minimal cookie-aware client that sends the CSRF header like the real frontend.
export function client(base) {
  let cookie = '';
  async function call(method, url, body, extraHeaders = {}) {
    const headers = { 'X-Requested-With': 'AccessOne', ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (cookie) headers.Cookie = cookie;
    const res = await fetch(base + url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    const set = res.headers.get('set-cookie');
    if (set) {
      const m = set.match(/ao_session=([^;]*)/);
      if (m) cookie = m[1] ? `ao_session=${m[1]}` : '';
    }
    const text = await res.text();
    let json; try { json = JSON.parse(text); } catch { json = text; }
    return { status: res.status, body: json, headers: res.headers };
  }
  return {
    get: (u, h) => call('GET', u, undefined, h),
    post: (u, b, h) => call('POST', u, b, h),
    patch: (u, b, h) => call('PATCH', u, b, h),
    del: (u, h) => call('DELETE', u, undefined, h),
    hasSession: () => !!cookie,
    async login(email, password) { return call('POST', '/api/auth/login', { email, password }); }
  };
}

// Direct SQLite access for seeding / asserting persisted state.
export async function openDb(dbPath) {
  const initSqlJs = createRequire(path.join(ROOT, 'package.json'))('sql.js');
  const SQL = await initSqlJs();
  const db = new SQL.Database(fs.readFileSync(dbPath));
  return {
    rows: (sql, params = {}) => {
      const stmt = db.prepare(sql); stmt.bind(params);
      const out = []; while (stmt.step()) out.push(stmt.getAsObject()); stmt.free(); return out;
    },
    run: (sql, params = {}) => db.run(sql, params),
    save: () => fs.writeFileSync(dbPath, Buffer.from(db.export()))
  };
}
