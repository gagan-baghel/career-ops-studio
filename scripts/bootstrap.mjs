#!/usr/bin/env node
// Installs the career-ops workspace this studio is built on, then lays our
// patches over it. Runs from `npm install` (postinstall) so a single clone of
// this repo gets a working system, and again on demand via `npm run bootstrap`.
//
// career-ops is NOT part of this repository — it is cloned into ./career-ops on
// first install and gitignored. This repo ships only the studio: the shell, the
// overlay patches, and this script.
//
// Everything here is idempotent: it skips what already exists, so re-running it
// after a `git pull` in either repo just re-applies the overlay.

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(process.env.CAREER_OPS_ROOT ?? join(HERE, 'career-ops'));
const REPO = process.env.CAREER_OPS_REPO ?? 'https://github.com/career-ops-hq/career-ops.git';
// Optional pin. The overlay patches 24 specific files; if upstream moves them,
// the overlay silently stops matching. Put a tag/branch/SHA in .upstream-ref to
// hold a known-good revision. Absent (the default) tracks upstream's tip.
const PIN = existsSync(join(HERE, '.upstream-ref'))
  ? readFileSync(join(HERE, '.upstream-ref'), 'utf8').split('\n').find((l) => l.trim() && !l.startsWith('#'))?.trim()
  : null;
const OVERLAY = join(HERE, 'overlay');

const say = (msg) => console.log(`  ${msg}`);
const run = (cmd, args, cwd) => {
  const r = spawnSync(cmd, args, { cwd, stdio: 'inherit' });
  if (r.error?.code === 'ENOENT') fail(`\`${cmd}\` not found. Install it and re-run \`npm run bootstrap\`.`);
  if (r.status !== 0) fail(`\`${cmd} ${args.join(' ')}\` failed in ${cwd}.`);
};
const fail = (msg) => {
  console.error(`\n  ✗ ${msg}\n`);
  process.exit(1);
};

// node-pty ships prebuilt binaries, but npm does not preserve the exec bit on
// spawn-helper — without it every terminal fails with "posix_spawnp failed".
function fixPtyHelper() {
  const dir = join(HERE, 'node_modules', 'node-pty', 'prebuilds');
  if (!existsSync(dir)) return;
  spawnSync('/bin/sh', ['-c', `chmod +x "${dir}"/*/spawn-helper 2>/dev/null || true`]);
}

// Copy every file under overlay/ onto the workspace, preserving structure.
async function applyOverlay() {
  if (!existsSync(OVERLAY)) return;
  const files = [];
  const walk = async (dir) => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name);
      if (entry.isDirectory()) await walk(full);
      else files.push(full);
    }
  };
  await walk(OVERLAY);

  for (const file of files) {
    const rel = relative(OVERLAY, file);
    const dest = join(ROOT, rel);
    await mkdir(dirname(dest), { recursive: true });
    await cp(file, dest);
  }
  say(`Applied ${files.length} studio patch${files.length === 1 ? '' : 'es'} over the workspace.`);
}

async function main() {
  if (process.env.STUDIO_SKIP_BOOTSTRAP) return;
  fixPtyHelper();

  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) fail(`Node ${process.versions.node} is too old — career-ops/web needs Node 22+.`);

  if (!existsSync(ROOT)) {
    say(`Cloning career-ops → ${ROOT}`);
    run('git', PIN ? ['clone', '--quiet', REPO, ROOT] : ['clone', '--quiet', '--depth', '1', REPO, ROOT], HERE);
    if (PIN) {
      say(`Checking out pinned revision ${PIN}`);
      run('git', ['checkout', '--quiet', PIN], ROOT);
    }
  } else {
    say(`Using the career-ops workspace at ${ROOT}`);
  }

  if (!existsSync(join(ROOT, 'node_modules'))) {
    say('Installing career-ops dependencies (this also fetches Playwright chromium)…');
    run('npm', ['install'], ROOT);
  }

  const web = join(ROOT, 'web');
  if (!existsSync(join(web, 'node_modules'))) {
    say('Installing career-ops web dependencies…');
    run('npm', [existsSync(join(web, 'package-lock.json')) ? 'ci' : 'install'], web);
  }

  await applyOverlay();

  // Config templates the doctor asks for. Copied only when absent — never
  // overwriting a profile the user has already filled in.
  const copies = [
    ['config/profile.example.yml', 'config/profile.yml'],
    ['modes/_profile.template.md', 'modes/_profile.md'],
    ['templates/portals.example.yml', 'portals.yml'],
  ];
  for (const [from, to] of copies) {
    const src = join(ROOT, from);
    const dst = join(ROOT, to);
    if (existsSync(src) && !existsSync(dst)) {
      await cp(src, dst);
      say(`Created ${to} from the template.`);
    }
  }

  const hasCv = existsSync(join(ROOT, 'cv.md'));
  console.log('\n  career-ops studio is ready.\n');
  say('Start it with:  get me hired      (or npm start)');
  if (!hasCv) say('Still needed:   cv.md in the workspace — your CV in markdown.');
  console.log('');
}

main().catch((err) => fail(err.message));
