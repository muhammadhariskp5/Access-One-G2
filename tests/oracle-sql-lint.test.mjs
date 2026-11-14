// Oracle treats '' as NULL. A default of '' in a comparison (COALESCE(x, '') NOT IN ..., LIKE ...,
// <> ...) therefore yields NULL instead of a definite answer, and rows silently drop out - which the
// SQLite test database (where '' is a real empty string) cannot show. This check keeps that
// pattern out of the server's SQL; use a sentinel such as '~' instead.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, '$1')), '..');
const files = [path.join(ROOT, 'server.ts')];
(function walk(dir) {
  for (const f of fs.readdirSync(dir)) {
    const p = path.join(dir, f);
    if (fs.statSync(p).isDirectory()) walk(p);
    else if (p.endsWith('.ts')) files.push(p);
  }
})(path.join(ROOT, 'src', 'server'));

test("no COALESCE(x, '') used in a comparison (Oracle reads '' as NULL)", () => {
  const offenders = [];
  // COALESCE(..., '') [ ) ...] followed by a comparison on the same line
  const re = /COALESCE\((?:[^()]|\([^()]*\))*,\s*''\s*\)\)*\s*(NOT\s+IN|IN\s*\(|<>|!=|=|LIKE|>=|<=|>|<)/i;
  for (const f of files) {
    fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
      if (re.test(line)) offenders.push(`${path.relative(ROOT, f)}:${i + 1}: ${line.trim().slice(0, 140)}`);
    });
  }
  assert.deepEqual(offenders, []);
});
