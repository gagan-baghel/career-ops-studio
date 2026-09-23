import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWrite, atomicWriteWithBackup } from "@/lib/core/safe-write";
import { normalizeUrl } from "@/lib/core/url-key.mjs";
import { closeEntries, htmlToText, pendingEntries } from "@/lib/core/pipeline-close.mjs";

// Is every posting in the inbox still open? Zero LLM tokens, and no browser:
//   1. the core's ATS API check (liveness-api.mjs) — authoritative for
//      Greenhouse/Lever/Ashby/Workday postings;
//   2. otherwise a plain page fetch, classified by the core's own rules
//      (liveness-core.mjs), trusting only the verdicts a static fetch can
//      prove: HTTP 404/410, a redirect to an "expired" URL, a hard closure
//      banner. A JS-rendered page reads as empty without a browser, so
//      anything else stays open.
// ponytail: no Playwright rung, so a JS-only careers page that closed is only
// caught by `node check-liveness.mjs` in the terminal. Add it if that matters.
// Closed entries move to "Processed" in modes/pipeline.md's own format.

const RECHECK_MS = 12 * 3_600_000;
const BATCH = 40;
const DEADLINE_MS = 45_000;
const POOL = 4;
const TRUSTED_CLOSED = new Set(["http_gone", "expired_url", "expired_body"]);

type Verdict = { result: "active" | "expired" | "uncertain"; code: string; reason: string };
type Cache = Record<string, Verdict & { at: number }>;
type Entry = { url: string; company: string; role: string };
export type ClosedPosting = { url: string; company: string; role: string; reason: string };

const root = () => careerOpsRoot();
const pipelineFile = () => path.join(root(), "data", "pipeline.md");
const cacheFile = () => path.join(root(), "data", "cache", "liveness.json");
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const core = (file: string): Promise<any> => import(/* webpackIgnore: true */ pathToFileURL(path.join(root(), file)).href);
export const livenessKey = (url: string) => normalizeUrl(url) || url.trim();

/** Run `fn` holding the core's data/pipeline.md lock, so a web write never
 *  interleaves with a scan appending to the same file. */
export async function withPipelineFileLock<T>(file: string, fn: () => Promise<T>): Promise<T> {
  let lock: ((f: string, fn: () => Promise<T>, o: { timeoutMs: number }) => Promise<T>) | null = null;
  try {
    const mod = await core("pipeline-lock.mjs");
    if (typeof mod?.withPipelineLock === "function") lock = mod.withPipelineLock;
  } catch {
    lock = null; // an older checkout without the lock: write unlocked, as before
  }
  return lock ? lock(file, fn, { timeoutMs: 15_000 }) : fn();
}

function readCache(): Cache {
  try {
    return JSON.parse(fs.readFileSync(cacheFile(), "utf8")) as Cache;
  } catch {
    return {};
  }
}

/** URLs the sweep has seen closed — used to keep them out of "new this week". */
export function knownClosedKeys(): Set<string> {
  const c = readCache();
  return new Set(Object.keys(c).filter((k) => c[k].result === "expired"));
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function checkPage(url: string, browser: any, classify: any, ua: string): Promise<Verdict> {
  const unknown = (reason: string): Verdict => ({ result: "uncertain", code: "static_unknown", reason });
  let current = url;
  // Follow redirects by hand so every hop passes the core's private-network guard.
  for (let hop = 0; hop < 5; hop++) {
    const bad = browser.rejectPrivateOrInvalid(current);
    if (bad) return unknown(bad.reason);
    try {
      await browser.validateUrlSecurity(current);
      const res = await fetch(current, {
        redirect: "manual",
        headers: { "user-agent": ua, accept: "text/html,application/xhtml+xml" },
        signal: AbortSignal.timeout(12_000),
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        current = new URL(loc, current).href;
        continue;
      }
      const html = res.ok ? (await res.text()).slice(0, 2_000_000) : "";
      const v: Verdict = classify({ status: res.status, requestedUrl: url, finalUrl: current, bodyText: htmlToText(html) });
      return v.result === "expired" && TRUSTED_CLOSED.has(v.code) ? v : unknown(v.reason);
    } catch (e) {
      return unknown(e instanceof Error ? e.message : "fetch failed");
    }
  }
  return unknown("too many redirects");
}

export async function sweepPipeline(): Promise<{ checked: number; remaining: number; closed: ClosedPosting[] }> {
  const file = pipelineFile();
  if (!fs.existsSync(file)) return { checked: 0, remaining: 0, closed: [] };
  const [api, browser, lcore, uaMod] = await Promise.all([
    core("liveness-api.mjs"),
    core("liveness-browser.mjs"),
    core("liveness-core.mjs"),
    core("user-agent.mjs"),
  ]);

  const cache = readCache();
  const now = Date.now();
  const due = (pendingEntries(fs.readFileSync(file, "utf8")) as Entry[]).filter((e) => {
    const hit = cache[livenessKey(e.url)];
    return !hit || now - hit.at > RECHECK_MS;
  });
  const batch = due.slice(0, BATCH);
  const deadline = now + DEADLINE_MS;
  const found = new Map<string, ClosedPosting>();
  let checked = 0;

  const queue = [...batch];
  await Promise.all(
    Array.from({ length: POOL }, async () => {
      for (let e = queue.shift(); e && Date.now() < deadline; e = queue.shift()) {
        const v: Verdict =
          (await api.checkLivenessViaApi(e.url).catch(() => null)) ??
          (await checkPage(e.url, browser, lcore.classifyLiveness, uaMod.BROWSER_LIKE_USER_AGENT));
        const key = livenessKey(e.url);
        cache[key] = { ...v, at: Date.now() };
        checked++;
        if (v.result === "expired") found.set(key, { ...e, reason: v.reason });
      }
    }),
  );

  atomicWrite(cacheFile(), JSON.stringify(cache));
  if (found.size) {
    await withPipelineFileLock(file, async () => {
      // Re-read inside the lock: a scan may have appended since.
      const src = fs.readFileSync(file, "utf8");
      const next = closeEntries(src, new Set(found.keys()), livenessKey);
      if (next !== src) atomicWriteWithBackup(file, next);
    });
  }
  return { checked, remaining: due.length - checked, closed: [...found.values()] };
}
