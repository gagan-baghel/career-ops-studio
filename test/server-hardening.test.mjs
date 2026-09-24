// Robustness of the studio server: static paths, headers, /pty limits, the web
// supervisor and shutdown. Boots the real server against a fake workspace whose
// `npm run dev` prints coloured output and never becomes ready. Run: npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { WebSocket } from 'ws';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4800 + Math.floor(Math.random() * 400);
const BASE = `http://127.0.0.1:${PORT}`;
const ORIGIN = { origin: `http://localhost:${PORT}` };
const ROOT = mkdtempSync(join(tmpdir(), 'studio-hard-'));
const PIDFILE = join(ROOT, 'web.pid');
let server;

const boot = (port, root, extra = {}) =>
  spawn(process.execPath, [join(HERE, 'server.mjs')], {
    env: { ...process.env, STUDIO_PORT: String(port), WEB_PORT: String(port + 1), STUDIO_NO_OPEN: '1', CAREER_OPS_ROOT: root, ...extra },
    stdio: ['ignore', 'ignore', 'pipe'],
  });

before(async () => {
  const webDir = join(ROOT, 'web');
  mkdirSync(join(webDir, 'node_modules', 'next'), { recursive: true });
  writeFileSync(join(webDir, 'node_modules', 'next', 'package.json'), '{}');
  writeFileSync(join(webDir, 'package.json'), JSON.stringify({ scripts: { dev: 'node dev.js' } }));
  writeFileSync(
    join(webDir, 'dev.js'),
    `require('fs').writeFileSync(${JSON.stringify(PIDFILE)}, String(process.pid));
     process.stdout.write('x'.repeat(200000) + '\\n');
     setTimeout(() => process.stdout.write('\\x1b[32m\\x1b[1mhello-ready\\x1b[0m \\x1b]0;title\\x07\\n'), 100);
     setInterval(() => {}, 1000);`,
  );
  server = boot(PORT, ROOT, { SHELL: '/bin/sh' });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`${BASE}/api/state`).catch(() => null)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => server.exitCode === null && server.kill('SIGKILL'));

// fetch() normalises the path client-side; http.get sends it byte for byte.
const raw = (path) =>
  new Promise((ok) =>
    http.get({ port: PORT, host: '127.0.0.1', path }, (r) => {
      let body = '';
      r.on('data', (c) => (body += c)).on('end', () => ok({ status: r.statusCode, body }));
    }),
  );

test('static serving refuses traversal, NUL and malformed escapes', async () => {
  for (const p of ['/%2e%2e/server.mjs', '/..%2fserver.mjs', '/..%5cserver.mjs', '/%2e%2e%2fpackage.json']) {
    const r = await raw(p);
    assert.ok([403, 404].includes(r.status), `${p} → ${r.status}`);
    assert.ok(!r.body.includes('career-ops'), `${p} leaked a file`);
  }
  assert.equal((await raw('/%00')).status, 400);
  assert.equal((await raw('/%E0%A4%A')).status, 400);
  assert.equal((await raw('/app.js')).status, 200);
});

test('security headers are on every response and the CSP hash matches the inline script', async () => {
  const r = await fetch(`${BASE}/`);
  const csp = r.headers.get('content-security-policy');
  const inline = (await r.text()).match(/<script>([\s\S]*?)<\/script>/)[1];
  assert.ok(csp.includes(`'sha256-${createHash('sha256').update(inline).digest('base64')}'`));
  assert.match(csp, /frame-ancestors 'none'/);
  assert.match(csp, new RegExp(`connect-src 'self' ws://localhost:${PORT} ws://127.0.0.1:${PORT}`));
  for (const res of [r, await fetch(`${BASE}/nope`), await fetch(`${BASE}/api/state`, { headers: { origin: 'https://evil.example' } })]) {
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(res.headers.get('referrer-policy'), 'no-referrer');
    assert.equal(res.headers.get('cross-origin-opener-policy'), 'same-origin-allow-popups');
    assert.ok(res.headers.get('content-security-policy'));
  }
});

test('/api/portals carries each company\'s section, job board and notes', async () => {
  writeFileSync(
    join(ROOT, 'portals.yml'),
    `tracked_companies:\n  # -- AI Labs --\n  - name: Acme\n    careers_url: https://job-boards.greenhouse.io/acme\n    notes: "Remote"\n  - name: Off\n    careers_url: https://off.example\n    enabled: false\n  # -- Europe --\n  - name: Beta\n    careers_url: https://beta.example/careers\n`,
  );
  const list = await (await fetch(`${BASE}/api/portals`)).json();
  assert.deepEqual(list, [
    { name: 'Acme', url: 'https://job-boards.greenhouse.io/acme', group: 'AI Labs', ats: 'Greenhouse', notes: 'Remote' },
    { name: 'Beta', url: 'https://beta.example/careers', group: 'Europe', ats: null, notes: null },
  ]);
});

test('/api/state reports install and terminal facts', async () => {
  const s = await (await fetch(`${BASE}/api/state`)).json();
  assert.equal(s.installed, true);
  assert.equal(typeof s.terminals, 'number');
  assert.equal(typeof s.since, 'number');
});

test('JSON APIs are not cached', async () => {
  for (const p of ['/api/state', '/api/portals']) assert.equal((await fetch(BASE + p)).headers.get('cache-control'), 'no-store');
});

test('/api/restart: 409 while starting, 405 for non-POST', async () => {
  assert.equal((await fetch(`${BASE}/api/state`).then((r) => r.json())).web, 'starting');
  assert.equal((await fetch(`${BASE}/api/restart`, { method: 'POST' })).status, 409);
  assert.equal((await fetch(`${BASE}/api/restart`)).status, 405);
});

test('boot log is ANSI-free and capped at ~64 KiB', async () => {
  let log = '';
  for (let i = 0; i < 100 && !log.includes('hello-ready'); i++) {
    await new Promise((r) => setTimeout(r, 100));
    log = await (await fetch(`${BASE}/api/log`)).text();
  }
  assert.ok(log.includes('hello-ready'), 'dev output never reached the log');
  assert.ok(!log.includes('\x1b'), 'ANSI left in log');
  assert.ok(log.length <= 64 * 1024, `log is ${log.length} chars`);
});

const connect = (qs = '') =>
  new Promise((ok, fail) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/pty${qs}`, { headers: ORIGIN });
    ws.on('open', () => ok(ws)).on('error', fail);
  });
const closed = (ws) => new Promise((ok) => ws.on('close', (code, reason) => ok({ code, reason: String(reason) })));
const alive = async () => (await fetch(`${BASE}/api/state`)).status === 200;

test('/pty survives absurd sizes, huge frames and abrupt disconnects', async () => {
  const ws = await connect('?cols=NaN&rows=1e9');
  for (const [cols, rows] of [[NaN, 5], ['x', 'y'], [1e12, -5], [null, 3], [{}, []]]) ws.send(JSON.stringify({ type: 'resize', cols, rows }));
  ws.send('not json');
  const big = await connect();
  const done = closed(big);
  big.send(Buffer.alloc(2 << 20), { binary: true });
  assert.equal((await done).code, 1009); // message too big
  (await connect()).terminate();
  await new Promise((r) => setTimeout(r, 200));
  assert.ok(await alive());
  ws.close();
});

test('at most 16 terminals; the 17th closes with 1013', async () => {
  const socks = [];
  try {
    for (let i = 0; i < 16; i++) socks.push(await connect());
    const extra = await connect();
    socks.push(extra);
    const { code, reason } = await closed(extra);
    assert.equal(code, 1013);
    assert.match(reason, /too many terminals/);
  } finally {
    socks.forEach((s) => s.close());
  }
  await new Promise((r) => setTimeout(r, 300));
  const again = await connect(); // slots are released on close
  const res = await Promise.race([closed(again), new Promise((r) => setTimeout(() => r('open'), 300))]);
  assert.equal(res, 'open');
  again.close();
});

test('another app on a pinned WEB_PORT is reported, never framed as the workspace', async () => {
  const foreign = http.createServer((q, r) => r.writeHead(200, { 'content-type': 'text/html' }).end('<title>not career-ops</title>'));
  await new Promise((r) => foreign.listen(0, '127.0.0.1', r));
  const webPort = foreign.address().port;
  const port = webPort + 7;
  const child = boot(port, ROOT, { WEB_PORT: String(webPort) });
  try {
    let state;
    for (let i = 0; i < 50 && state?.web !== 'down'; i++) {
      await new Promise((r) => setTimeout(r, 100));
      state = await fetch(`http://127.0.0.1:${port}/api/state`).then((r) => r.json()).catch(() => null);
    }
    assert.equal(state?.web, 'down');
    const log = await (await fetch(`http://127.0.0.1:${port}/api/log`)).text();
    assert.match(log, new RegExp(`Port ${webPort} is used by another app`));
  } finally {
    child.kill('SIGKILL');
    foreign.close();
  }
});

test('a busy port exits 1 with a one-line hint', async () => {
  const blocker = createServer().listen(0, '127.0.0.1');
  await new Promise((r) => blocker.once('listening', r));
  const port = blocker.address().port;
  const child = boot(port, ROOT);
  let err = '';
  child.stderr.on('data', (b) => (err += b));
  const code = await new Promise((r) => child.on('exit', r));
  blocker.close();
  assert.equal(code, 1);
  assert.match(err, new RegExp(`Port ${port} is busy`));
  assert.ok(!err.includes('    at '), 'printed a stack trace');
});

test('SIGTERM kills the PTYs and the web app, then exits 0', async () => {
  const ws = await connect();
  const wsDone = closed(ws);
  const webPid = Number(readFileSync(PIDFILE, 'utf8'));
  const t0 = Date.now();
  server.kill('SIGTERM');
  const code = await new Promise((r) => server.on('exit', r));
  assert.equal(code, 0);
  assert.ok(Date.now() - t0 < 3500);
  await wsDone;
  assert.throws(() => process.kill(webPid, 0), /ESRCH/);
});
