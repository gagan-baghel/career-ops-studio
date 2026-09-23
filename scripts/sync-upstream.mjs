#!/usr/bin/env node
// Move the studio onto a newer career-ops (maintainers).
//
//   npm run sync-upstream              # onto career-ops main
//   npm run sync-upstream -- <ref>     # onto a tag / branch / SHA
//
// The overlay replaces whole files, so it cannot simply be copied over a newer
// career-ops: that would undo upstream's own changes to those files. Instead
// this puts the overlay on the revision it was built for (.upstream-ref) as a
// commit, lets git rebase it onto the target — a real 3-way merge — and writes
// the merged files back into overlay/ with the new pin.
//
// On a conflict it stops and prints the scratch checkout: resolve there,
// `git rebase --continue`, then `npm run sync-upstream -- --export <dir>`.

import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const REPO = process.env.CAREER_OPS_REPO ?? 'https://github.com/career-ops-hq/career-ops.git';
const OVERLAY = join(HERE, 'overlay');
const REF_FILE = join(HERE, '.upstream-ref');
const PIN = readFileSync(REF_FILE, 'utf8').split('\n').map((l) => l.trim()).find((l) => l && !l.startsWith('#'));

const git = (cwd, ...args) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (r.status !== 0) throw Object.assign(new Error(`git ${args.join(' ')}\n${r.stderr}`), { r });
  return r.stdout.trim();
};

function exportOverlay(dir) {
  const base = git(dir, 'merge-base', 'HEAD', 'target');
  const files = git(dir, 'diff', '--name-only', '--diff-filter=AM', base, 'HEAD').split('\n').filter(Boolean);
  rmSync(OVERLAY, { recursive: true, force: true });
  for (const f of files) {
    mkdirSync(dirname(join(OVERLAY, f)), { recursive: true });
    cpSync(join(dir, f), join(OVERLAY, f));
  }
  const text = readFileSync(REF_FILE, 'utf8');
  writeFileSync(REF_FILE, text.replace(PIN, base));
  console.log(`\n  overlay/ rebuilt: ${files.length} files over career-ops ${base.slice(0, 7)}.`);
  console.log('  Next: npm run bootstrap && (cd career-ops/web && npm test && npx tsc --noEmit)\n');
}

const args = process.argv.slice(2);
if (args[0] === '--export') {
  exportOverlay(resolve(args[1]));
  process.exit(0);
}

const target = args[0] ?? 'main';
const dir = mkdtempSync(join(tmpdir(), 'career-ops-sync-'));
console.log(`  Cloning career-ops into ${dir}…`);
git(HERE, 'clone', '--quiet', '--filter=blob:none', REPO, dir);
git(dir, 'config', 'user.name', 'career-ops studio');
git(dir, 'config', 'user.email', 'studio@localhost');
git(dir, 'checkout', '--quiet', '-b', 'studio', PIN);
cpSync(OVERLAY, dir, { recursive: true });
git(dir, 'add', '-A');
git(dir, 'commit', '--quiet', '-m', 'studio overlay');
git(dir, 'branch', 'target', target);

try {
  git(dir, 'rebase', '--quiet', 'target');
} catch {
  const conflicts = spawnSync('git', ['diff', '--name-only', '--diff-filter=U'], { cwd: dir, encoding: 'utf8' }).stdout.trim();
  console.error(`\n  ✗ Upstream changed the same lines as the overlay in:\n${conflicts.replace(/^/gm, '      ')}`);
  console.error(`\n  Resolve them in ${dir}, run \`git add -A && git rebase --continue\` there,`);
  console.error(`  then: npm run sync-upstream -- --export ${dir}\n`);
  process.exit(1);
}
exportOverlay(dir);
rmSync(dir, { recursive: true, force: true });
