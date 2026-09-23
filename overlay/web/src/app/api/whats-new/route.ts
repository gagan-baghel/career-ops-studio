import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot, readApplications, readInbox } from "@/lib/career-ops";
import { knownClosedKeys, livenessKey } from "@/lib/core/liveness";
import { getNormalizeTextKey } from "@/lib/core/text-key";
import { evaluatedKeys, isEvaluated } from "@/lib/whats-new-suppression.mjs";
import type { DiscoveredOffer } from "@/lib/explore";
import { collectWhatsNew, resolveOfferLimit } from "@/lib/whats-new.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// A posting published longer ago than this is not "new", however recently a
// scan first saw it.
const MAX_POSTING_AGE_DAYS = 30;

// The SUPPLY loop, ZERO tokens: "new matches this week" = roles surfaced by past
// free scans (data/scan-history.tsv) in the last N days that the user hasn't
// evaluated yet. No scan runs here — it reads the history a past scan already
// wrote, so the home stays instant + free (directly answers the #1 token-cost
// complaint). cols: url, first_seen, portal, title, company, status, location.
// Company matching keys come from the CORE (see lib/core/text-key.ts), never a
// local reimplementation. The previous ASCII-only key deleted every non-Latin
// letter, so "Škoda" collided with "Koda" — suppressing a real offer as
// "already evaluated" — and "日本電産" keyed to the empty string (#2666).

export async function GET(req: Request) {
  const searchParams = new URL(req.url).searchParams;
  const days = Math.min(30, Math.max(1, Number(searchParams.get("days")) || 7));
  // Home only needs enough offers for its cards; Explore's “See all” hand-off
  // asks for more. Both stay finite — `count` is always complete, so the true
  // total is free while the rendered list keeps a ceiling (see MAX_OFFER_LIMIT).
  const offerLimit = resolveOfferLimit(searchParams.get("limit"));
  const cutoff = Date.now() - days * 86_400_000;
  let rows: string[];
  try {
    rows = fs.readFileSync(path.join(careerOpsRoot(), "data", "scan-history.tsv"), "utf8").split("\n");
  } catch {
    return Response.json({ offers: [], count: 0 });
  }

  // Roles already evaluated → don't resurface as "new". Keyed on company AND
  // role, not company alone: suppressing by employer removed that employer's
  // entire board after one evaluation (#3131). See lib/whats-new-suppression.
  const normalizeTextKey = await getNormalizeTextKey();
  const evaluated = evaluatedKeys(readApplications(), normalizeTextKey);

  // scan-history.tsv is an append-only log: on its own it keeps offering
  // postings that have since closed, that the user removed from the inbox, or
  // that were months old when first seen. "New" must mean still pending in
  // data/pipeline.md, not seen closed, and published recently.
  const hasPipeline = fs.existsSync(path.join(careerOpsRoot(), "data", "pipeline.md"));
  const pending = new Set(readInbox().filter((j) => !j.done).map((j) => livenessKey(j.url)));
  const closed = knownClosedKeys();
  const staleBefore = Date.now() - MAX_POSTING_AGE_DAYS * 86_400_000;

  const toOffer = (c: string[]): DiscoveredOffer | null => {
    const [url, firstSeen, portal, title, company, status, location] = c;
    const posted = /^\d{4}-\d{2}-\d{2}$/.test(c[8] || "") ? c[8] : "";
    if (!url || !/^https?:\/\//i.test(url)) return null;
    if (status && !/^added$/i.test(status.trim())) return null;
    const key = livenessKey(url);
    if (closed.has(key) || (hasPipeline && !pending.has(key))) return null;
    if (posted && Date.parse(posted) < staleBefore) return null;
    if (isEvaluated(evaluated, normalizeTextKey, company, title)) return null;
    return {
      url,
      company: (company || "").trim(),
      title: (title || "").trim(),
      location: (location || "").trim(),
      postedAt: posted || (/^\d{4}-\d{2}-\d{2}$/.test(firstSeen || "") ? firstSeen : ""),
      ats: (portal || "").replace(/-full$/, "").trim() || "other",
      source: "whats-new",
    };
  };

  const { offers, count } = collectWhatsNew(rows, { cutoff, toOffer, offerLimit });
  return Response.json({ offers, count });
}
