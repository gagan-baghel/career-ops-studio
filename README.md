# career-ops studio

**A desktop app for your job search — the whole [career-ops](https://github.com/career-ops-hq/career-ops) pipeline in one window, no terminal required.**

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/node-%E2%89%A522-brightgreen.svg)](https://nodejs.org)
[![Platform](https://img.shields.io/badge/platform-macOS%20%7C%20Linux-lightgrey.svg)](#)
[![Built on career-ops](https://img.shields.io/badge/built%20on-career--ops-orange.svg)](https://github.com/career-ops-hq/career-ops)

career-ops is a genuinely good AI job-search system — it scores postings against
your CV, writes tailored resumes that can't invent facts, drafts cover letters,
and tracks every application. It is also terminal-first, which puts a lot of
people off before they ever see what it does.

**This is the front end it was missing.** One window: the workspace UI, a job
browser pinned beside it, and a real terminal you can hide with a keystroke.
Everything career-ops does, without living in a shell.

```bash
git clone https://github.com/gagan-baghel/career-ops-studio
cd career-ops-studio && npm install
get me hired
```

That is the whole setup. `npm install` fetches career-ops for you.

![career-ops studio — the workspace, with scored roles awaiting a decision](public/screenshots/01-workspace.png)

---

### What you get

- **Score jobs against your real CV** — paste a URL, get a 1–5 fit rating with the gaps named honestly, not a hype score.
- **Tailored CVs and cover letters as PDFs** — with a fact-checker that blocks any claim your CV doesn't support.
- **A job browser beside your workspace** — postings open in a real window, so your existing logins just work.
- **A built-in terminal** — real shell, your own config, hidden until you want it (`⌃\``).
- **Your data never leaves your machine.** No account, no server, no telemetry. Everything is local files you own.

## Install

```bash
git clone https://github.com/gagan-baghel/career-ops-studio
cd career-ops-studio && npm install
```

`npm install` does the rest: it clones the
[career-ops](https://github.com/career-ops-hq/career-ops) workspace into
`./career-ops`, installs both sets of dependencies (including Playwright
chromium), lays this repo's patches over it, and copies the config templates
career-ops asks for. Re-run it any time with `npm run bootstrap` — it is
idempotent and skips whatever already exists.

Then:

```bash
get me hired     # start it and open the browser
get me fired     # stop it
```

`get` is installed from this package's `bin`. Without a global link, use
`./bin/get me hired`, `npm start`, or double-click `start.command`.

Point it at an existing checkout instead of cloning with
`CAREER_OPS_ROOT=/path/to/career-ops npm install`.

## What this repo does and does not contain

This repo is **only the studio**: the shell, the overlay, and the setup scripts.
It does not contain career-ops.

career-ops is upstream's project and stays upstream's project. It is cloned from
its own repository at install time into `./career-ops`, which is gitignored. That
means two things worth being explicit about:

- **You are not redistributing his code.** Users get career-ops from
  career-ops-hq, at the revision in `.upstream-ref`, as a normal git checkout.
- **Your job search never touches this repo.** Once installed, `career-ops/`
  holds your `cv.md`, `config/profile.yml`, `data/`, `reports/`, `output/` and
  `jds/`. The whole directory is ignored, so none of it can be committed by
  accident.

## Updating

The overlay replaces whole files, so it only matches the career-ops revision it
was built on. That revision is pinned in `.upstream-ref`. **Don't `git pull`
inside `career-ops/`.** Instead:

```bash
git pull && npm run bootstrap
```

`bootstrap` moves `career-ops/` to the pinned revision, reinstalls dependencies
only if a lockfile changed, and re-applies the overlay. Your files (`cv.md`,
`config/`, `portals.yml`, `data/`, `reports/`, `output/` …) are gitignored by
career-ops, so the sync never touches them. A workspace from an older studio
(a plain copy with no `.git`) is adopted in place the same way.

**Moving to a newer career-ops (maintainers):**

```bash
npm run sync-upstream          # or: npm run sync-upstream -- <tag|sha>
npm run bootstrap && (cd career-ops/web && npm test && npx tsc --noEmit)
```

`sync-upstream` commits the overlay on the pinned revision and rebases it onto
upstream, so git merges upstream's changes into the overlaid files instead of
overwriting them. Then it rebuilds `overlay/` and moves the pin. If upstream
changed the same lines, it stops and tells you which files to resolve.

## What it adds

| | |
| --- | --- |
| **Workspace** | The career-ops web app (`career-ops/web`), started and supervised for you. Nothing is reimplemented — it's the project's own UI. |
| **Jobs** | Opens postings in one dedicated browser window pinned beside the studio. Loads the 119 companies from your own `portals.yml`, or any URL you paste. |
| **Terminal** | Real PTY sessions rooted in the workspace. Tabs, drag-to-resize, `⌃\`` to toggle. Runs your own shell config. |
| **Evaluate** | Writes the job URL into a Claude session — **staged, never sent**. You press Enter. |
| **⌘K** | Command palette: jump to any workspace page, open sessions, run doctor, toggle theme. |
| **The buddy** | A small agent in the bottom-right that narrates what is *actually* happening — the command you ran, real output arriving, a job window opening, the server changing state. It wanders and sits when nothing is running, and says so. Click it to mute. |

## Keyboard

| | |
| --- | --- |
| `⌘K` | Command palette |
| `⌃\`` | Show / hide terminal |
| `⌘1` / `⌘2` | Workspace / Jobs |

## How it fits together

One Node process, bound to `127.0.0.1` only:

- **:4321** — the studio UI, plus `/pty` (WebSocket → real PTYs) and the small
  `/api` used by the shell.
- **:3000** — the career-ops web app, spawned on boot. If one is already
  running, the studio attaches to it instead of starting a second.

Three details worth knowing, because they were not obvious:

1. **Job pages open in a real window, not an iframe.** `X-Frame-Options` and
   CSP `frame-ancestors` only restrict *framing*, so a top-level window opened
   with `window.open` is immune to them — no proxy, no rewriting, and your
   existing logins work. The window is named, so every posting reuses the same
   one instead of piling up tabs, and it's sized to the right half of your
   screen so it sits beside the studio.
2. **Terminals get Node 22 via a ZDOTDIR shim** (`shell/`). A typical `.zshrc`
   rebuilds `PATH` from scratch and nvm re-applies its default, so an inherited
   `PATH` never survives. The shim sources your real dotfiles first, then
   prepends the workspace Node — your prompt, aliases and config are untouched.
3. **The terminal never auto-runs anything.** Evaluate types the URL and stops.
   That mirrors career-ops' own rule: it drafts, you decide.
4. **The buddy only claims what it can see.** Its working pose is driven by real
   bytes arriving from a PTY, and its lines come from the command you submitted
   plus action-verb patterns in the output — never a noun alone. `cv.md not
   found` in a doctor checklist is a *check*, not work on your CV, and it stays
   silent for it. When nothing is running it idles and says nothing is running,
   which is the whole point: an idle buddy is honest, a buddy pretending to work
   is the animation we removed everywhere else.

## What this repo patches

The studio wraps career-ops' own web app rather than reimplementing it, so a few
changes have to land *in* that app. They live in `overlay/`, which mirrors the
workspace's layout and is copied over it on every bootstrap:

| File | Change |
| --- | --- |
| `beta-banner.tsx` | The bug reporter rests as a circular icon covering no content, and expands on hover or keyboard focus. |
| `app-shell.tsx` | Sidebar footer padded so the bug button never sits on its text. |
| `globals.css` | Worker "running" bar is static — an indeterminate sweep animates identically whether a run is progressing or wedged. |
| `worker-card.tsx` | Running spinner → static dot, for the same reason. The honest signals beside it (last log line, elapsed, tokens) only move when the run moves. |
| `discovering-state.tsx` | Dropped the pulsing source orb and the skeleton shimmer. |
| `next.config.mjs` | Hides Next's dev-tools badge, which is pinned over the bug button. |
| `targeting-form.tsx` + `config/page.tsx` | **Targeting** section on Config: target roles and job locations, written to `portals.yml`. Both were wired end to end already but reachable only by asking the assistant. |
| `profile-form.tsx` | **Profile** section on Config: name, contact, links, comp range, walk-away minimum, work-location flexibility → `config/profile.yml`. Same story — merge-safe writer existed, no form did. |
| `api/portals/route.ts` | Adds a read endpoint; raises a role cap that silently deleted roles 25+ on every save (the shipped template has 30); lets an emptied list actually clear a filter; and persists the exclusion / blocked / always-allow lists the Explore bar can express but nothing could save. |
| `api/profile/route.ts` | Adds a read endpoint, and a free-text comp range so a unit like `18-30 LPA` survives a save (the numeric path rebuilt it as `18-30`). |
| `filter-builder.tsx` | **Save as my defaults** in Explore's Location & scope — filters seeded *from* `portals.yml` but never flowed back, so a refinement lasted one session. |
| `lib/core/liveness.ts` + `inbox/liveness-sweep.tsx` + `api/pipeline/liveness` | **Closed jobs leave on their own.** When the app opens, every inbox posting not checked in the last 12 h is checked, with zero tokens: the core's ATS API check (Greenhouse, Lever, Ashby, Workday), then a plain page fetch through the core's own classifier and private-network guard. Closed postings move to *Processed* in `modes/pipeline.md`'s format (`- [x] ~~URL \| Co \| Role~~ — posting expired`), with a `.bak` first, and a notice says which ones. |
| `api/whats-new/route.ts` | **Today's "fresh matches" only shows real, open jobs.** It read `scan-history.tsv`, a log of every posting a scan ever saw. So it offered jobs you'd removed, jobs that had closed, and jobs posted months before the scan found them. Now a job must still be pending in your inbox, not seen closed, and posted in the last 30 days. |
| `lib/career-ops.ts` | A struck-through `~~URL…~~` inbox row (a closed posting) is read as done, not as a live job. |
| `api/pipeline/remove/route.ts` | Remove/undo writes hold the core's pipeline lock so they can't race a scan, and undo puts rows back under *Pending*, not *Processed*. |
| `api/run/route.ts`, `jobs/job-store.tsx`, `run-prompts.mjs` | Scoring a posting that turns out to be closed removes it from the inbox instead of failing. |
| `layout.tsx` | Defaults the assistant to local Claude Code. |

These are whole files, rebuilt by `npm run sync-upstream` whenever the pin moves.
Never edit them inside `career-ops/`: the next bootstrap puts the overlay back.

## Configuration

| Variable | Default |
| --- | --- |
| `CAREER_OPS_ROOT` | `./career-ops` |
| `STUDIO_PORT` | `4321` |
| `WEB_PORT` | `3000` |
| `STUDIO_NO_OPEN` | unset — set it to skip auto-opening the browser |
| `STUDIO_SKIP_BOOTSTRAP` | set it to make `npm install` skip the workspace setup |

## Known limits

- The theme toggle themes the **studio chrome only**. The workspace app keeps
  its own theme (it's a separate origin, so its setting isn't reachable).
- The job window is a separate origin, so the studio can't read where you
  browsed to inside it. Copy the address there (`⌘L ⌘C`) and hit **Paste** to
  pull it back — then Evaluate has the exact posting.
- Pop-ups must be allowed for `localhost` (they are by default for a real click;
  the pane tells you if the browser blocked one).
- Requires Node ≥ 22 (inherited from `career-ops/web`).
- The on-open closed-job check has no browser, so a careers page that only
  renders with JavaScript can't be confirmed closed. It stays in the inbox until
  you check it, or run `node check-liveness.mjs --file …` in the terminal.
- The terminal socket only accepts the studio's own page (Host and Origin are
  checked), because it is a real shell on your Mac.

## Credits and licence

**career-ops** is by [Santiago Fernández de Valderrama](https://santifer.io),
MIT licensed: <https://github.com/career-ops-hq/career-ops>. It is **not**
redistributed here — `npm install` fetches it from his repository, so you get it
first-hand with its own history and licence.

**career-ops studio** — `server.mjs`, `public/`, `shell/`, `bin/`, `scripts/`,
`overlay/` — is this repo's own work, also MIT. See `LICENSE`.

The studio adds a window. The job search underneath is career-ops', and the
credit for it is his.
