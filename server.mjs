#!/usr/bin/env node
// career-ops studio — local desktop shell around the career-ops workspace.
//
// One process: serves the studio UI, supervises the career-ops web app, hands
// out real PTYs over WebSocket, and reads the workspace's own config.
// Binds to 127.0.0.1 only — nothing here is meant to face a network.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream, existsSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, join, extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';
import { load as parseYaml } from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.STUDIO_PORT ?? 4321);
// The web port moves off 3000 when another app holds it, unless the user pinned it.
const WEB_PINNED = process.env.WEB_PORT != null;
let WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const ROOT = resolve(process.env.CAREER_OPS_ROOT ?? join(HERE, 'career-ops'));
const webUrl = (path = '/') => `http://127.0.0.1:${WEB_PORT}${path}`;

// The studio may be launched by any node; the career-ops web app needs >= 22.
// Put the node running us first on PATH so children inherit the same version.
const NODE_BIN = dirname(process.execPath);
const CHILD_ENV = { ...process.env, PATH: `${NODE_BIN}:${process.env.PATH}` };

// Interactive shells are a different story: a typical .zshrc rebuilds PATH from
// scratch (and nvm re-applies its default version), so an inherited PATH never
// survives. Point zsh at a shim ZDOTDIR that sources the user's own dotfiles
// first and prepends the workspace Node last — same trick VS Code uses.
function shellEnv(shell) {
  const env = { ...CHILD_ENV, TERM: 'xterm-256color', COLORTERM: 'truecolor' };
  if (/zsh$/.test(shell)) {
    env.ZDOTDIR = join(HERE, 'shell');
    env.USER_ZDOTDIR = process.env.ZDOTDIR || process.env.HOME;
    env.STUDIO_NODE_BIN = NODE_BIN;
  }
  return env;
}

// ── career-ops web app supervisor ──────────────────────────────────────────
// next dev colours its output; the boot log is shown as plain text, so strip
// ANSI (CSI, OSC, and lone ESC sequences) and cap by size, not entry count.
const ANSI = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)|\x1b[@-_]/g;
const LOG_CAP = 64 * 1024;
const web = { state: 'starting', since: Date.now(), log: [], logLen: 0, child: null };
const note = (line) => {
  line = line.replace(ANSI, '').slice(-LOG_CAP);
  web.log.push(line);
  web.logLen += line.length;
  while (web.logLen > LOG_CAP) web.logLen -= web.log.shift().length;
};

// Resolves the HTTP status, or 0 when nothing answers.
const probe = (path = '/', timeout = 2000) =>
  new Promise((ok) => {
    const req = http.get(webUrl(path), { timeout }, (res) => {
      res.resume();
      ok(res.statusCode || 1);
    });
    req.on('error', () => ok(0));
    req.on('timeout', () => (req.destroy(), ok(0)));
  });

// Port 3000 is every dev server's default. Something answering there is only
// the workspace if it serves career-ops' own /api/version as JSON; otherwise
// the studio would frame some other app as "your workspace".
const isWorkspace = () =>
  new Promise((ok) => {
    const req = http.get(webUrl('/api/version'), { timeout: 8000 }, (res) => {
      res.resume();
      ok(res.statusCode === 200 && !!res.headers['content-type']?.includes('json'));
    });
    req.on('error', () => ok(false));
    req.on('timeout', () => (req.destroy(), ok(false)));
  });

async function startWeb() {
  web.state = 'starting';
  web.since = Date.now();
  if (await probe()) {
    if (await isWorkspace()) {
      web.state = 'ready';
      web.since = Date.now();
      note(`Attached to a career-ops web server already running on ${webUrl()}`);
      return;
    }
    if (WEB_PINNED) {
      web.state = 'down';
      note(`Port ${WEB_PORT} is used by another app, not career-ops. Stop it, or set WEB_PORT to a free port.\n`);
      return;
    }
    const taken = WEB_PORT;
    for (let p = taken + 1; p <= taken + 50; p++) {
      WEB_PORT = p;
      if (!(await probe())) break;
    }
    note(`Port ${taken} is used by another app; using ${WEB_PORT} for the workspace.\n`);
  }
  if (!existsSync(join(ROOT, 'web', 'node_modules', 'next', 'package.json'))) {
    web.state = 'down';
    note(`The career-ops workspace is not installed (or its install is broken).\nRun \`npm run bootstrap\` in ${HERE}, then press Retry.\n`);
    return;
  }
  note(`Starting career-ops web (${join(ROOT, 'web')})…`);
  // detached = own process group, so stopWeb can take down npm *and* next dev.
  const child = (web.child = spawn('npm', ['run', 'dev'], {
    cwd: join(ROOT, 'web'),
    env: { ...CHILD_ENV, PORT: String(WEB_PORT) },
    detached: true,
  }));
  child.stdout.on('data', (b) => note(b.toString()));
  child.stderr.on('data', (b) => note(b.toString()));
  child.on('exit', (code) => {
    if (web.child !== child) return;
    web.child = null;
    web.state = 'down';
    note(`career-ops web exited (code ${code}).`);
  });

  for (let i = 0; i < 150; i++) {
    if (await probe()) {
      web.state = 'ready';
      web.since = Date.now();
      note(`career-ops web is ready on ${webUrl()}`);
      return;
    }
    if (web.state === 'down') return;
    await new Promise((r) => setTimeout(r, 400));
  }
  web.state = 'down';
  note('Timed out waiting for the career-ops web server.');
}

const stopWeb = () =>
  new Promise((ok) => {
    const c = web.child;
    if (!c) return ok();
    web.child = null;
    c.once('exit', ok);
    try {
      process.kill(-c.pid);
    } catch {
      ok();
    }
  });

// ── static assets ──────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

// xterm ships as a dependency; serve it from node_modules rather than a CDN so
// the studio keeps working with no network.
const VENDOR = {
  '/vendor/xterm.js': '@xterm/xterm/lib/xterm.js',
  '/vendor/xterm.css': '@xterm/xterm/css/xterm.css',
  '/vendor/addon-fit.js': '@xterm/addon-fit/lib/addon-fit.js',
  '/vendor/addon-web-links.js': '@xterm/addon-web-links/lib/addon-web-links.js',
};

async function sendFile(res, path) {
  try {
    const info = await stat(path);
    if (!info.isFile()) throw new Error('not a file');
    res.writeHead(200, {
      'content-type': MIME[extname(path)] ?? 'application/octet-stream',
      'content-length': info.size,
      'cache-control': 'no-store',
    });
    createReadStream(path).pipe(res);
  } catch {
    res.writeHead(404, { 'content-type': 'text/plain' }).end('not found');
  }
}

// ── response headers ───────────────────────────────────────────────────────
// CSP allows exactly the one inline theme script in index.html, by hash. It is
// computed from the file at startup so edits to that script only need a restart
// (never an unsafe-inline). xterm injects <style> elements, hence style-src.
const PUBLIC = join(HERE, 'public');
const INLINE_HASHES = [
  ...readFileSync(join(PUBLIC, 'index.html'), 'utf8').matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g),
].map(([, body]) => `'sha256-${createHash('sha256').update(body).digest('base64')}'`);
// frame-src takes any localhost port: the page is served (and its CSP fixed)
// before the supervisor knows whether the workspace had to move off 3000.
const CSP = [
  "default-src 'self'",
  `script-src 'self' ${INLINE_HASHES.join(' ')}`,
  "style-src 'self' 'unsafe-inline'",
  `connect-src 'self' ws://localhost:${PORT} ws://127.0.0.1:${PORT}`,
  'frame-src http://localhost:* http://127.0.0.1:*',
  "img-src 'self' data:",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'self'",
  "frame-ancestors 'none'",
  ].join('; ');
const HEADERS = {
  'content-security-policy': CSP,
  'x-content-type-options': 'nosniff',
  'referrer-policy': 'no-referrer',
  // Not `same-origin`: that would sever the handle app.js keeps on the job
  // window it window.open()s (focus/close/.closed). allow-popups keeps it.
  'cross-origin-opener-policy': 'same-origin-allow-popups',
};
const JSON_HEAD = { 'content-type': 'application/json', 'cache-control': 'no-store' };

// ── the workspace's own target companies ───────────────────────────────────
// portals.yml is what `npm run scan` crawls. Reusing it means the browser pane
// launches the boards the user actually tracks instead of a generic bookmark list.
// The job boards career-ops scans, recognised from the careers URL host.
const ATS = [
  ['greenhouse', 'Greenhouse'], ['ashbyhq', 'Ashby'], ['lever.co', 'Lever'],
  ['myworkdayjobs', 'Workday'], ['workable', 'Workable'], ['smartrecruiters', 'SmartRecruiters'],
  ['recruitee', 'Recruitee'], ['personio', 'Personio'], ['teamtailor', 'Teamtailor'], ['bamboohr', 'BambooHR'],
];
const atsOf = (url) => {
  try {
    const host = new URL(url).hostname;
    return ATS.find(([k]) => host.includes(k))?.[1] ?? null;
  } catch {
    return null;
  }
};

// YAML parsing drops comments, but portals.yml groups companies under
// `# -- Section --` headings. Read them from the raw text, in list order.
const sectionsOf = (text) => {
  const out = [];
  let group = null;
  let inList = false;
  for (const line of text.split('\n')) {
    if (/^tracked_companies:/.test(line)) inList = true;
    else if (inList && /^\S/.test(line) && !line.startsWith('#')) break;
    if (!inList) continue;
    const h = line.match(/^\s*#\s*--+\s*(.+?)\s*--+\s*$/);
    if (h) group = h[1];
    else if (/^\s*-\s+name:/.test(line)) out.push(group);
  }
  return out;
};

async function portals() {
  for (const file of ['portals.yml', join('templates', 'portals.example.yml')]) {
    try {
      const text = await readFile(join(ROOT, file), 'utf8');
      const list = parseYaml(text)?.tracked_companies ?? [];
      const groups = sectionsOf(text);
      const aligned = groups.length === list.length; // else a group could land on the wrong company
      return list
        .map((c, i) => ({ c, group: aligned ? groups[i] : null }))
        .filter(({ c }) => c?.name && c?.careers_url && c.enabled !== false)
        .map(({ c, group }) => ({
          name: String(c.name),
          url: String(c.careers_url),
          group: group ?? 'Other',
          ats: atsOf(String(c.careers_url)),
          notes: typeof c.notes === 'string' ? c.notes : null,
        }));
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

// ── who may talk to us ─────────────────────────────────────────────────────
// Binding to 127.0.0.1 is not enough: any web page the user has open can still
// aim a request or a WebSocket at localhost, and /pty is a real shell. Require
// our own Host (defeats DNS rebinding) and, when a browser sends one, our own
// Origin (defeats cross-site pages). Non-browser local clients send no Origin.
const OURS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`]);
const trusted = (req) => {
  if (!OURS.has(req.headers.host)) return false;
  const origin = req.headers.origin;
  return !origin || OURS.has(origin.replace(/^http:\/\//, ''));
};

// ── http ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  for (const [k, v] of Object.entries(HEADERS)) res.setHeader(k, v);
  if (!trusted(req)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden');
    return;
  }
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === '/api/state') {
    res.writeHead(200, JSON_HEAD).end(
      JSON.stringify({
        web: web.state,
        webUrl: `http://localhost:${WEB_PORT}`,
        root: ROOT,
        // For the boot steps and the system panel: facts, not guesses.
        installed: existsSync(join(ROOT, 'web', 'node_modules', 'next', 'package.json')),
        terminals: ptys.size,
        since: web.since,
      }),
    );
    return;
  }
  if (path === '/api/restart') {
    if (req.method !== 'POST') res.writeHead(405, { allow: 'POST' }).end();
    // 409 so the UI can tell "already starting" from "restart accepted".
    else if (web.state === 'starting') res.writeHead(409).end();
    else {
      web.state = 'starting';
      stopWeb().then(startWeb);
      res.writeHead(204).end();
    }
    return;
  }
  if (path === '/api/log') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8', 'cache-control': 'no-store' }).end(web.log.join(''));
    return;
  }
  if (path === '/api/portals') {
    res
      .writeHead(200, JSON_HEAD)
      .end(JSON.stringify(await portals()));
    return;
  }
  if (VENDOR[path]) {
    await sendFile(res, join(HERE, 'node_modules', VENDOR[path]));
    return;
  }

  // Decode first, then resolve and require the result to stay inside public/.
  let rel;
  try {
    rel = decodeURIComponent(path === '/' ? '/index.html' : path);
  } catch {
    rel = '\0';
  }
  if (rel.includes('\0')) {
    res.writeHead(400, { 'content-type': 'text/plain' }).end('bad request');
    return;
  }
  const file = resolve(PUBLIC, '.' + rel);
  if (!file.startsWith(PUBLIC + sep)) {
    res.writeHead(403, { 'content-type': 'text/plain' }).end('forbidden');
    return;
  }
  await sendFile(res, file);
});

// ── PTY over WebSocket ─────────────────────────────────────────────────────
// Text frames are control JSON; binary frames are raw keystrokes. Keeping them
// on separate frame types means no escaping and no way for typed text to be
// mistaken for a command.
// maxPayload: keystrokes and resize JSON are tiny; don't let one frame balloon memory.
const wss = new WebSocketServer({ server, path: '/pty', maxPayload: 1 << 20, verifyClient: ({ req }) => trusted(req) });
wss.on('error', () => {}); // ws re-emits the http server's errors; handled on `server` below.

const MAX_PTYS = 16;
const ptys = new Set();
// Integer in [lo, hi], or undefined for anything that isn't a finite number.
const dim = (v, lo, hi) => {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() ? Number(v) : NaN;
  return Number.isFinite(n) ? Math.min(hi, Math.max(lo, Math.trunc(n))) : undefined;
};

wss.on('connection', (ws, req) => {
  ws.on('error', () => {}); // bad frames / abrupt disconnects end in 'close'; never crash.
  if (ptys.size >= MAX_PTYS) {
    ws.close(1013, `too many terminals (max ${MAX_PTYS})`);
    return;
  }
  const params = new URL(req.url, 'http://x').searchParams;
  const shell = process.env.SHELL || '/bin/zsh';
  const wants = params.get('cmd') === 'claude';
  const term = pty.spawn(shell, wants ? ['-lic', 'claude'] : ['-l'], {
    name: 'xterm-256color',
    cols: dim(params.get('cols'), 2, 1000) ?? 100,
    rows: dim(params.get('rows'), 2, 500) ?? 24,
    cwd: ROOT,
    env: shellEnv(shell),
  });
  ptys.add(term);
  let exited = false;

  term.onData((d) => ws.readyState === 1 && ws.send(d));
  term.onExit(({ exitCode }) => {
    exited = true;
    ptys.delete(term);
    if (ws.readyState === 1) {
      ws.send(`\r\n\x1b[38;5;245m— session ended (${exitCode}) —\x1b[0m\r\n`);
      ws.close();
    }
  });

  ws.on('message', (data, isBinary) => {
    if (exited) return; // node-pty throws on write/resize after exit
    try {
      if (isBinary) return term.write(data.toString('utf8'));
      const msg = JSON.parse(data.toString());
      const cols = dim(msg?.cols, 2, 1000);
      const rows = dim(msg?.rows, 2, 500);
      if (msg?.type === 'resize' && cols && rows) term.resize(cols, rows);
    } catch {
      /* ignore malformed control frames */
    }
  });

  ws.on('close', () => {
    ptys.delete(term);
    try {
      term.kill();
    } catch {
      /* already gone */
    }
  });
});

// ── boot ───────────────────────────────────────────────────────────────────
server.on('error', (err) => {
  if (err.code !== 'EADDRINUSE') throw err;
  console.error(`Port ${PORT} is busy — is the studio already running? Open http://localhost:${PORT} or set STUDIO_PORT.`);
  process.exit(1);
});

server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  career-ops studio  →  ${url}`);
  console.log(`  workspace          →  ${ROOT}\n`);
  if (!process.env.STUDIO_NO_OPEN) {
    spawn(process.platform === 'darwin' ? 'open' : 'xdg-open', [url], { stdio: 'ignore' })
      .on('error', () => {}) // no opener installed: the URL is printed above
      .unref();
  }
  startWeb();
});

// Kill every child we own; a hard timeout so one stuck child can't hang exit.
let stopping = false;
const shutdown = (code = 0) => {
  if (stopping) return;
  stopping = true;
  setTimeout(() => process.exit(code || 1), 3000).unref();
  for (const t of ptys) {
    try {
      t.kill();
    } catch {
      /* already gone */
    }
  }
  server.close();
  server.closeAllConnections();
  stopWeb().then(() => process.exit(code));
};
process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));
process.on('uncaughtException', (err) => {
  console.error(err);
  shutdown(1);
});
