// Pure data/pipeline.md edits for the liveness sweep (lib/core/liveness.ts).
// Kept free of Next aliases so node --test can import it directly.

export const CLOSED_SUFFIX = "— posting expired (liveness sweep)";
const PENDING_LINE = /^\s*-\s*\[ \]\s*(?!~~)(.+)$/;
const PROCESSED = /^##\s+(Processed|Procesad|Verarbeitet|Traité)/i;

/** Open `- [ ] URL | Company | Role …` rows. @param {string} text */
export function pendingEntries(text) {
  const out = [];
  for (const line of String(text).split("\n")) {
    const m = line.match(PENDING_LINE);
    if (!m) continue;
    const [url, company = "", role = ""] = m[1].split("|").map((s) => s.trim());
    if (/^https?:\/\//i.test(url)) out.push({ url, company, role });
  }
  return out;
}

/**
 * Move the pending rows whose key is in `closed` to "## Processed" as
 * `- [x] ~~URL | Company | Role~~ — posting expired (liveness sweep)`, the
 * format modes/pipeline.md prescribes. Everything else is left byte-identical.
 * @param {string} text @param {Set<string>} closed @param {(url: string) => string} keyOf
 */
export function closeEntries(text, closed, keyOf) {
  const struck = [];
  const kept = String(text).split("\n").filter((line) => {
    const m = line.match(PENDING_LINE);
    if (!m) return true;
    const cells = m[1].split("|").map((s) => s.trim());
    if (!closed.has(keyOf(cells[0]))) return true;
    struck.push(`- [x] ~~${cells.slice(0, 3).join(" | ")}~~ ${CLOSED_SUFFIX}`);
    return false;
  });
  if (!struck.length) return text;
  const at = kept.findIndex((l) => PROCESSED.test(l));
  if (at >= 0) kept.splice(at + 1, 0, ...struck);
  else {
    while (kept.length && !kept[kept.length - 1].trim()) kept.pop();
    kept.push("", "## Processed", ...struck);
  }
  return kept.join("\n").replace(/\n*$/, "\n");
}

/** Visible text of an HTML page — scripts/templates dropped so i18n strings
 *  ("This job has expired") embedded in a live page are not read as a banner.
 *  @param {string} html */
export function htmlToText(html) {
  return String(html)
    .replace(/<(script|style|template|noscript|svg)\b[\s\S]*?<\/\1>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
}
