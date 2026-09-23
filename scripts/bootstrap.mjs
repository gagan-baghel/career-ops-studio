#!/usr/bin/env node
// Installs the career-ops workspace this studio is built on, then lays our
// patches over it. Runs from `npm install` (postinstall) so a single clone of
// this repo gets a working system, and again on demand via `npm run bootstrap`.
//
// career-ops is NOT part of this repository — it is cloned into ./career-ops on
// first install and gitignored. This repo ships only the studio: the shell, the
// overlay patches, and this script.
//
// Everything here is idempotent: re-running it after a `git pull` of this repo
// moves the workspace to the new pin, reinstalls what changed, and re-applies
// the overlay. Your own files are never touched.

import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { cp, mkdir, readdir, stat } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = resolve(process.env.CAREER_OPS_ROOT ?? join(HERE, 'career-ops'));
const REPO = process.env.CAREER_OPS_REPO ?? 'https://github.com/career-ops-hq/career-ops.git';
// The career-ops revision the overlay was built and tested on. The overlay
// replaces whole files, so running it over any other revision would silently
// undo upstream's changes to those files. `npm run sync-upstream` moves it.
const PIN = readFileSync(join(HERE, '.upstream-ref'), 'utf8')
  .split('\n')
  .map((l) => l.trim())
  .find((l) => l && !l.startsWith('#'));
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

const git = (args) => spawnSync('git', args, { cwd: ROOT, encoding: 'utf8' });

// Put the workspace's SYSTEM files at exactly PIN. Your job search — cv.md,
// config/profile.yml, portals.yml, data/, reports/, output/ … — is gitignored
// by career-ops, and a reset never touches ignored or untracked files. A
// workspace installed by an older studio (a plain copy, no .git) is adopted
// in place the same way.
function syncWorkspace() {
  if (!existsSync(join(ROOT, '.git'))) {
    say(existsSync(ROOT) ? `Adopting the existing workspace at ${ROOT} into git` : `Installing career-ops → ${ROOT}`);
    mkdirSync(ROOT, { recursive: true });
    run('git', ['init', '--quiet'], ROOT);
    run('git', ['remote', 'add', 'origin', REPO], ROOT);
  }
  if (git(['rev-parse', 'HEAD']).stdout.trim() === PIN) return;
  say(`Syncing career-ops to ${PIN.slice(0, 7)}…`);
  run('git', ['fetch', '--quiet', '--depth', '1', 'origin', PIN], ROOT);
  run('git', ['reset', '--quiet', '--hard', 'FETCH_HEAD'], ROOT);
}

// Reinstall only when the lockfile (or manifest) changed since the last install.
function installDeps(dir, label, args) {
  // Hashed again after the install: `npm install` may write the lockfile.
  const hash = () =>
    createHash('sha256')
      .update(['package.json', 'package-lock.json'].map((f) => (existsSync(join(dir, f)) ? readFileSync(join(dir, f)) : '')).join('\0'))
      .digest('hex');
  const stamp = join(dir, 'node_modules', '.studio-install');
  if (existsSync(stamp) && readFileSync(stamp, 'utf8') === hash()) return;
  say(`Installing ${label} dependencies…`);
  run('npm', args, dir);
  writeFileSync(stamp, hash());
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
  say(`Applied ${files.length} studio file${files.length === 1 ? '' : 's'} over career-ops ${PIN.slice(0, 7)}.`);
}

async function main() {
  if (process.env.STUDIO_SKIP_BOOTSTRAP) return;
  fixPtyHelper();

  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) fail(`Node ${process.versions.node} is too old — career-ops/web needs Node 22+.`);

  if (!PIN) fail('.upstream-ref has no revision in it.');
  syncWorkspace();
  installDeps(ROOT, 'career-ops', ['install', '--no-audit', '--no-fund']);
  const web = join(ROOT, 'web');
  installDeps(web, 'career-ops web', [existsSync(join(web, 'package-lock.json')) ? 'ci' : 'install', '--no-audit', '--no-fund']);

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
