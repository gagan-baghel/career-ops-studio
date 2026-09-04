#!/usr/bin/env node
// career-ops studio — local desktop shell around the career-ops workspace.
//
// One process: serves the studio UI, supervises the career-ops web app, hands
// out real PTYs over WebSocket, and reads the workspace's own config.
// Binds to 127.0.0.1 only — nothing here is meant to face a network.

import http from 'node:http';
import { spawn } from 'node:child_process';
import { readFile, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { dirname, join, normalize, extname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';
import pty from 'node-pty';
import { load as parseYaml } from 'js-yaml';

const HERE = dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.STUDIO_PORT ?? 4321);
const WEB_PORT = Number(process.env.WEB_PORT ?? 3000);
const ROOT = resolve(process.env.CAREER_OPS_ROOT ?? join(HERE, 'career-ops'));
const WEB_URL = `http://127.0.0.1:${WEB_PORT}`;

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
const web = { state: 'starting', log: [], child: null };
const note = (line) => {
  web.log.push(line);
  if (web.log.length > 400) web.log.shift();
};

const probe = () =>
  new Promise((ok) => {
    const req = http.get(WEB_URL, { timeout: 2000 }, (res) => {
      res.resume();
      ok(true);
    });
    req.on('error', () => ok(false));
    req.on('timeout', () => (req.destroy(), ok(false)));
  });

async function startWeb() {
  if (await probe()) {
    web.state = 'ready';
    note(`Attached to a career-ops web server already running on ${WEB_URL}`);
    return;
  }
  note(`Starting career-ops web (${join(ROOT, 'web')})…`);
  web.child = spawn('npm', ['run', 'dev'], {
    cwd: join(ROOT, 'web'),
    env: { ...CHILD_ENV, PORT: String(WEB_PORT) },
  });
  web.child.stdout.on('data', (b) => note(b.toString()));
  web.child.stderr.on('data', (b) => note(b.toString()));
  web.child.on('exit', (code) => {
    web.state = 'down';
    note(`career-ops web exited (code ${code}).`);
  });

  for (let i = 0; i < 150; i++) {
    if (await probe()) {
      web.state = 'ready';
      note(`career-ops web is ready on ${WEB_URL}`);
      return;
    }
    if (web.state === 'down') return;
    await new Promise((r) => setTimeout(r, 400));
  }
  web.state = 'down';
  note('Timed out waiting for the career-ops web server.');
}

// ── static assets ──────────────────────────────────────────────────────────
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
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

// ── the workspace's own target companies ───────────────────────────────────
// portals.yml is what `npm run scan` crawls. Reusing it means the browser pane
// launches the boards the user actually tracks instead of a generic bookmark list.
async function portals() {
  for (const file of ['portals.yml', join('templates', 'portals.example.yml')]) {
    try {
      const doc = parseYaml(await readFile(join(ROOT, file), 'utf8'));
      return (doc?.tracked_companies ?? [])
        .filter((c) => c?.name && c?.careers_url && c.enabled !== false)
        .map((c) => ({ name: String(c.name), url: String(c.careers_url) }));
    } catch {
      /* try the next candidate */
    }
  }
  return [];
}

// ── http ───────────────────────────────────────────────────────────────────
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://127.0.0.1:${PORT}`);
  const path = url.pathname;

  if (path === '/api/state') {
    res.writeHead(200, { 'content-type': 'application/json' }).end(
      JSON.stringify({
        web: web.state,
        webUrl: `http://localhost:${WEB_PORT}`,
        root: ROOT,
      }),
    );
    return;
  }
  if (path === '/api/log') {
    res.writeHead(200, { 'content-type': 'text/plain; charset=utf-8' }).end(web.log.join(''));
    return;
  }
  if (path === '/api/portals') {
    res
      .writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify(await portals()));
    return;
  }
  if (VENDOR[path]) {
    await sendFile(res, join(HERE, 'node_modules', VENDOR[path]));
    return;
  }

  const rel = normalize(path === '/' ? '/index.html' : path).replace(/^(\.\.[/\\])+/, '');
  await sendFile(res, join(HERE, 'public', rel));
});

// ── PTY over WebSocket ─────────────────────────────────────────────────────
// Text frames are control JSON; binary frames are raw keystrokes. Keeping them
// on separate frame types means no escaping and no way for typed text to be
// mistaken for a command.
const wss = new WebSocketServer({ server, path: '/pty' });

wss.on('connection', (ws, req) => {
  const params = new URL(req.url, 'http://x').searchParams;
  const shell = process.env.SHELL || '/bin/zsh';
  const wants = params.get('cmd') === 'claude';
  const term = pty.spawn(shell, wants ? ['-lic', 'claude'] : ['-l'], {
    name: 'xterm-256color',
    cols: Number(params.get('cols')) || 100,
    rows: Number(params.get('rows')) || 24,
    cwd: ROOT,
    env: shellEnv(shell),
  });

  term.onData((d) => ws.readyState === 1 && ws.send(d));
  term.onExit(({ exitCode }) => {
    if (ws.readyState === 1) {
      ws.send(`\r\n\x1b[38;5;245m— session ended (${exitCode}) —\x1b[0m\r\n`);
      ws.close();
    }
  });

  ws.on('message', (data, isBinary) => {
    if (isBinary) {
      term.write(data.toString('utf8'));
      return;
    }
    try {
      const msg = JSON.parse(data.toString());
      if (msg.type === 'resize') term.resize(Math.max(2, msg.cols), Math.max(2, msg.rows));
    } catch {
      /* ignore malformed control frames */
    }
  });

  ws.on('close', () => {
    try {
      term.kill();
    } catch {
      /* already gone */
    }
  });
});

// ── boot ───────────────────────────────────────────────────────────────────
server.listen(PORT, '127.0.0.1', async () => {
  const url = `http://localhost:${PORT}`;
  console.log(`\n  career-ops studio  →  ${url}`);
  console.log(`  workspace          →  ${ROOT}\n`);
  if (!process.env.STUDIO_NO_OPEN) spawn('open', [url], { stdio: 'ignore' }).unref();
  startWeb();
});

const shutdown = () => {
  web.child?.kill();
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
