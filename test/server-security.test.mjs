// /pty is a real shell, so who may open it matters more than anything else in
// this repo. Boots the real server and tries. Run: npm test

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import http from 'node:http';
import { WebSocket } from 'ws';

const HERE = join(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 4400 + Math.floor(Math.random() * 400);
let server;

before(async () => {
  server = spawn(process.execPath, [join(HERE, 'server.mjs')], {
    env: { ...process.env, STUDIO_PORT: String(PORT), WEB_PORT: String(PORT + 1), STUDIO_NO_OPEN: '1', CAREER_OPS_ROOT: mkdtempSync(join(tmpdir(), 'studio-test-')) },
    stdio: 'ignore',
  });
  for (let i = 0; i < 50; i++) {
    if (await fetch(`http://127.0.0.1:${PORT}/api/state`).catch(() => null)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
});
after(() => server.kill());

const opens = (headers) =>
  new Promise((ok) => {
    const ws = new WebSocket(`ws://127.0.0.1:${PORT}/pty`, { headers });
    ws.on('open', () => (ws.close(), ok(true)));
    ws.on('error', () => ok(false));
  });

test('a page on another site cannot open a terminal', async () => {
  assert.equal(await opens({ origin: 'https://evil.example' }), false);
});

test('DNS rebinding (foreign Host) is refused', async () => {
  assert.equal(await opens({ host: `evil.example:${PORT}`, origin: `http://evil.example:${PORT}` }), false);
  // fetch() drops a custom Host header, so this one goes through http.
  const status = await new Promise((ok) =>
    http.get({ port: PORT, host: '127.0.0.1', path: '/api/log', headers: { host: 'evil.example' } }, (r) => (r.resume(), ok(r.statusCode))),
  );
  assert.equal(status, 403);
});

test('the studio page itself can open a terminal and use the API', async () => {
  assert.equal(await opens({ origin: `http://localhost:${PORT}` }), true);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/state`)).status, 200);
});

test('a cross-site POST cannot restart the workspace', async () => {
  const r = await fetch(`http://127.0.0.1:${PORT}/api/restart`, { method: 'POST', headers: { origin: 'https://evil.example' } });
  assert.equal(r.status, 403);
});
