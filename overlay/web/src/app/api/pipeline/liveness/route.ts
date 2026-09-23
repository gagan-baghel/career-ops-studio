import { sweepPipeline } from "@/lib/core/liveness";

// POST → check one batch of inbox postings that are due; closed ones move out
// of the inbox. The client calls again while `remaining` > 0. Zero LLM tokens.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

export async function POST() {
  try {
    return Response.json(await sweepPipeline());
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "liveness sweep failed" }, { status: 500 });
  }
}
