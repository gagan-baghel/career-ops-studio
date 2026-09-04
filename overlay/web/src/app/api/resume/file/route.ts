import fs from "node:fs";
import path from "node:path";
import { storedResume } from "../route";

// Serve the résumé back so it can be opened and checked. It is the user's own
// file on their own machine; nothing here writes or converts anything.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const TYPES: Record<string, string> = {
  ".pdf": "application/pdf",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ".doc": "application/msword",
  ".rtf": "application/rtf",
  ".txt": "text/plain; charset=utf-8",
};

export async function GET() {
  const file = storedResume();
  if (!file) return new Response("no résumé stored", { status: 404 });
  const ext = path.extname(file).toLowerCase();
  return new Response(fs.readFileSync(file), {
    headers: {
      "content-type": TYPES[ext] ?? "application/octet-stream",
      "content-disposition": `inline; filename="${path.basename(file)}"`,
      "cache-control": "no-store",
    },
  });
}
