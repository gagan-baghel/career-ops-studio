import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";

// Remove postings from data/pipeline.md for real. Skipping used to only add the
// URL to a browser-local "hidden" list, so the file — and the inbox count — kept
// every rejected posting forever, and clearing site data brought them all back.
//
// The removed lines are returned verbatim so an undo can put them back exactly.
// data/pipeline.md is USER LAYER (DATA_CONTRACT): atomic write, .bak first.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const file = () => path.join(careerOpsRoot(), "data", "pipeline.md");

function urlOf(line: string): string | null {
  const m = line.match(/^\s*-\s*\[[ xX]\]\s*(.+)$/);
  if (!m) return null;
  const first = m[1].split("|")[0].trim();
  return first || null;
}

export async function POST(req: Request) {
  let body: { urls?: string[] };
  try {
    body = (await req.json()) as { urls?: string[] };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const urls = new Set((Array.isArray(body.urls) ? body.urls : []).map((u) => String(u).trim()).filter(Boolean));
  if (urls.size === 0) return Response.json({ error: "no urls" }, { status: 400 });

  const p = file();
  if (!fs.existsSync(p)) return Response.json({ error: "no pipeline file" }, { status: 404 });

  const src = fs.readFileSync(p, "utf8");
  const removed: string[] = [];
  const kept = src.split("\n").filter((line) => {
    const u = urlOf(line);
    if (u && urls.has(u)) {
      removed.push(line);
      return false;
    }
    return true;
  });

  if (removed.length === 0) return Response.json({ ok: true, removed: [], count: 0 });

  try {
    atomicWriteWithBackup(p, kept.join("\n"));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, removed, count: removed.length });
}

// Put removed lines back, exactly as they were — the undo half of the pair.
export async function PUT(req: Request) {
  let body: { lines?: string[] };
  try {
    body = (await req.json()) as { lines?: string[] };
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const lines = (Array.isArray(body.lines) ? body.lines : []).filter((l) => typeof l === "string" && urlOf(l));
  if (lines.length === 0) return Response.json({ error: "no lines" }, { status: 400 });

  const p = file();
  const src = fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "# Pipeline — Pending URLs\n\n## Pending\n";
  const have = new Set(src.split("\n").map(urlOf).filter(Boolean) as string[]);
  const add = lines.filter((l) => !have.has(urlOf(l)!));
  if (add.length === 0) return Response.json({ ok: true, restored: 0 });

  const out = src.replace(/\s*$/, "") + "\n" + add.join("\n") + "\n";
  try {
    atomicWriteWithBackup(p, out);
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, restored: add.length });
}
