// Structured logger.
// - Production: one JSON object per line on stdout/stderr (pm2 captures and can rotate them;
//   any log tool can parse them). Development/test: short readable lines.
// - Level from LOG_LEVEL (debug | info | warn | error), default info.
// - No synchronous file writes on the request path.

type Level = 'debug' | 'info' | 'warn' | 'error';
const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const minLevel: Level = (['debug', 'info', 'warn', 'error'].includes(String(process.env.LOG_LEVEL))
  ? process.env.LOG_LEVEL : 'info') as Level;
const asJson = process.env.NODE_ENV === 'production';

function serializeError(err: unknown) {
  if (err instanceof Error) return { name: err.name, message: err.message, stack: err.stack };
  return err;
}

function write(level: Level, msg: string, fields?: Record<string, unknown>) {
  if (ORDER[level] < ORDER[minLevel]) return;
  const stream = level === 'error' || level === 'warn' ? process.stderr : process.stdout;
  if (asJson) {
    const entry: Record<string, unknown> = { time: new Date().toISOString(), level, msg };
    if (fields) for (const [k, v] of Object.entries(fields)) entry[k] = k === 'err' ? serializeError(v) : v;
    stream.write(JSON.stringify(entry) + '\n');
  } else {
    let line = `${level.toUpperCase().padEnd(5)} ${msg}`;
    if (fields) {
      const { err, ...rest } = fields as any;
      if (Object.keys(rest).length) line += ' ' + JSON.stringify(rest);
      if (err) line += '\n' + (err instanceof Error ? err.stack : JSON.stringify(err));
    }
    stream.write(line + '\n');
  }
}

export const logger = {
  debug: (msg: string, fields?: Record<string, unknown>) => write('debug', msg, fields),
  info: (msg: string, fields?: Record<string, unknown>) => write('info', msg, fields),
  warn: (msg: string, fields?: Record<string, unknown>) => write('warn', msg, fields),
  error: (msg: string, fields?: Record<string, unknown>) => write('error', msg, fields),
};

// Backwards-compatible helper used throughout the legacy routes.
export function debugLog(msg: string) {
  logger.info(msg);
}
