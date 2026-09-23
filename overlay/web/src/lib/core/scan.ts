import { spawn } from "node:child_process";
import fs from "node:fs";
import { careerOpsRoot, rootScript } from "@/lib/career-ops";
import { writeTempPortals, cleanupTempPortals } from "./portals";
import { ATS_SOURCES, type DiscoveredOffer, type ExploreFilters, type ScanEvent } from "@/lib/explore";

export type { DiscoveredOffer, ScanEvent, AtsSource } from "@/lib/explore";
export { ATS_SOURCES } from "@/lib/explore";

/**
 * ACL for the discovery engine — orchestrates the REAL core scanner
 * `scan-ats-full.mjs` (reverse ATS discovery) with `--dry-run --json`, so it
 * writes NOTHING and hands back one authoritative result object. It runs against
 * an EPHEMERAL filter file (never the user's portals.yml). Zero LLM tokens.
 *
 * Why one scanner process PER SOURCE, in parallel, each with a time budget:
 * a --json run only writes its result at the very end, so one slow source used
 * to sink them all. Workday is that source — a single large tenant can hold
 * the engine's 5-minute per-company watchdog, and our kill then threw away
 * Greenhouse/Lever/Ashby matches that were already found. Now each source
 * reports as soon as it is done, and CAREER_OPS_SCAN_BUDGET_MS makes the engine
 * stop on time and still return what it found (flagged `budgetHit`).
 *
 * `--shuffle`: `--limit N` without it takes the FIRST N companies of each
 * alphabetical directory, so every scan searched the same "A…" employers.
 */

// The API route's maxDuration is 300s. Each source gets SOURCE_BUDGET_MS to
// scan; the hard kill only fires if the engine overruns its own budget badly.
const SOURCE_BUDGET_MS = 180_000;
const HARD_KILL_MS = 280_000;

// Does the user's LOCAL scanner support the --json contract (#1199)?
export function scannerSupportsJson(): boolean {
  try {
    const src = fs.readFileSync(rootScript("scan-ats-full"), "utf8");
    return src.includes("--json") && src.includes("capHit");
  } catch {
    return false;
  }
}

const ATS_START_RE = /⚙\s+(\S+)\s+—\s+(\d+)\s+companies/;
const PROGRESS_RE = /(\d+)\/(\d+)\s+scanned,\s+(\d+)\s+total matches/;

function firstMatch(title: string, positives: string[]): string | undefined {
  const lower = title.toLowerCase();
  for (const k of positives) if (k && lower.includes(k.toLowerCase())) return k;
  return undefined;
}

type JsonOffer = { company?: string; title?: string; url?: string; location?: string | null; postedAt?: string | null; source?: string };
type ScanJson = {
  companiesAvailable?: number;
  companiesScanned?: number;
  capHit?: boolean;
  budgetHit?: boolean;
  stoppedByOutage?: boolean;
  datasetStatus?: Record<string, "ok" | "stale" | "empty">;
  postingsKept?: number;
  postingsDroppedNoDate?: number;
  unreachableBoards?: number;
  offers?: JsonOffer[];
};
type SourceResult = { ats: string; json: ScanJson | null; timedOut: boolean; stderrTail: string };

function scanSource(ats: string, filters: ExploreFilters, portals: string, onEvent: (e: ScanEvent) => void): Promise<SourceResult> {
  return new Promise((resolve) => {
    const child = spawn(
      process.execPath,
      [
        rootScript("scan-ats-full"),
        "--dry-run",
        "--json",
        "--shuffle",
        "--since",
        String(Math.max(1, filters.sinceDays || 7)),
        "--ats",
        ats,
        "--limit",
        String(Math.max(1, filters.limitPerAts || 150)),
      ],
      {
        cwd: careerOpsRoot(),
        env: { ...process.env, CAREER_OPS_PORTALS: portals, CAREER_OPS_SCAN_BUDGET_MS: String(SOURCE_BUDGET_MS) },
      },
    );

    let out = "";
    let errBuf = "";
    let errTail = "";
    let finished = false;
    let timedOut = false;
    const finish = (json: ScanJson | null) => {
      if (finished) return;
      finished = true;
      clearTimeout(killer);
      // The result is in hand. A budget-stopped engine can still have HTTP
      // requests in flight that keep the process alive — nothing left to wait for.
      try {
        child.kill("SIGTERM");
      } catch {
        /* already gone */
      }
      resolve({ ats, json, timedOut, stderrTail: errTail });
    };
    const killer = setTimeout(() => {
      timedOut = true;
      finish(null);
    }, HARD_KILL_MS);

    child.stdout.on("data", (d: Buffer) => {
      out += d.toString();
      // The engine writes its single result object followed by a newline.
      if (!out.endsWith("\n")) return;
      try {
        finish(JSON.parse(out) as ScanJson);
      } catch {
        /* partial chunk — wait for more */
      }
    });
    // Human progress lives on stderr in --json mode.
    child.stderr.on("data", (d: Buffer) => {
      errBuf += d.toString();
      const parts = errBuf.split(/\r\n|\r|\n/);
      errBuf = parts.pop() ?? "";
      for (const p of parts) {
        const line = p.trim();
        if (!line) continue;
        errTail = (errTail + "\n" + line).slice(-600);
        const start = line.match(ATS_START_RE);
        if (start) onEvent({ kind: "atsStart", ats, companies: Number(start[2]) });
        const prog = line.match(PROGRESS_RE);
        if (prog) onEvent({ kind: "progress", ats, scanned: Number(prog[1]), total: Number(prog[2]), matches: Number(prog[3]) });
        onEvent({ kind: "log", line });
      }
    });
    child.on("error", () => finish(null));
    child.on("close", () => {
      if (finished) return;
      try {
        finish(JSON.parse(out) as ScanJson);
      } catch {
        finish(null);
      }
    });
  });
}

export async function runDiscovery(filters: ExploreFilters, onEvent: (e: ScanEvent) => void): Promise<DiscoveredOffer[]> {
  if (!scannerSupportsJson()) {
    onEvent({ kind: "error", message: "Your career-ops scanner is too old for Explore. Run `npm run bootstrap` in the studio folder." });
    return [];
  }
  const sources = (filters.ats.length ? filters.ats : [...ATS_SOURCES]).filter((a) => (ATS_SOURCES as readonly string[]).includes(a));
  const portals = writeTempPortals(filters);
  const offers: DiscoveredOffer[] = [];
  const seen = new Set<string>();
  const total = { companiesScanned: 0, companiesAvailable: 0, unreachable: 0, dropped: 0, capHit: false, budgetHit: [] as string[] };
  const datasetStatus: Record<string, "ok" | "stale" | "empty"> = {};
  const failed: string[] = [];

  try {
    await Promise.all(
      sources.map(async (ats) => {
        const r = await scanSource(ats, filters, portals, onEvent);
        const j = r.json;
        if (!j || !Array.isArray(j.offers)) {
          failed.push(ats);
          onEvent({ kind: "atsDone", ats, unreachable: 0 });
          return;
        }
        for (const o of j.offers) {
          const url = (o.url || "").trim();
          if (!url || seen.has(url) || !o.company || !o.title) continue;
          seen.add(url);
          const source = o.source || `${ats}-full`;
          const offer: DiscoveredOffer = {
            company: o.company,
            title: o.title,
            location: o.location || "",
            postedAt: o.postedAt || "",
            ats: source.replace(/-full$/, ""),
            source,
            url,
            matchedKeyword: firstMatch(o.title, filters.positive),
          };
          offers.push(offer);
          onEvent({ kind: "offer", offer });
        }
        total.companiesScanned += j.companiesScanned ?? 0;
        total.companiesAvailable += j.companiesAvailable ?? 0;
        total.unreachable += j.unreachableBoards ?? 0;
        total.dropped += j.postingsDroppedNoDate ?? 0;
        total.capHit ||= Boolean(j.capHit);
        if (j.budgetHit || j.stoppedByOutage) total.budgetHit.push(ats);
        Object.assign(datasetStatus, j.datasetStatus ?? {});
        onEvent({ kind: "atsDone", ats, unreachable: j.unreachableBoards ?? 0, partial: Boolean(j.budgetHit || j.stoppedByOutage) });
      }),
    );
  } finally {
    cleanupTempPortals(portals);
  }

  onEvent({
    kind: "summary",
    companiesScanned: total.companiesScanned,
    unreachable: total.unreachable,
    matches: offers.length,
    companiesAvailable: total.companiesAvailable,
    capHit: total.capHit,
    datasetStatus,
    postingsDroppedNoDate: total.dropped,
    partialSources: total.budgetHit,
  });
  if (failed.length && !offers.length) {
    onEvent({ kind: "error", message: `The scan failed for ${failed.join(", ")}. Try again, or turn that source off under Sources.` });
  } else if (failed.length) {
    onEvent({ kind: "log", line: `No result from ${failed.join(", ")} — showing the other sources.` });
  }
  return offers;
}
