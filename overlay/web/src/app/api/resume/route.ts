import fs from "node:fs";
import path from "node:path";
import { careerOpsRoot } from "@/lib/career-ops";

// The candidate's OWN finished résumé — the file they already send to employers.
// The apply flow attaches a tailored CV when career-ops has generated one for
// that company; this is what it falls back to otherwise, so a file field is
// never left empty just because no tailored CV exists yet.
//
// Stored in documents/ (USER LAYER, per DATA_CONTRACT) under a fixed base name:
// the uploaded filename is NEVER used as a path, only its extension is honoured,
// so nothing a browser sends can escape the directory.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const ALLOWED = new Set([".pdf", ".docx", ".doc", ".rtf", ".txt"]);
const MAX_BYTES = 10 * 1024 * 1024;
const BASE = "application-resume";

function dir() {
  return path.join(careerOpsRoot(), "documents");
}

/** The stored résumé, whatever extension it was uploaded with. */
export function storedResume(): string | null {
  try {
    const hit = fs
      .readdirSync(dir())
      .find((f) => ALLOWED.has(path.extname(f).toLowerCase()) && path.parse(f).name === BASE);
    return hit ? path.join(dir(), hit) : null;
  } catch {
    return null;
  }
}

export async function GET() {
  const file = storedResume();
  if (!file) return Response.json({ exists: false });
  const st = fs.statSync(file);
  return Response.json({
    exists: true,
    name: path.basename(file),
    size: st.size,
    updated: st.mtime.toISOString(),
    path: path.relative(careerOpsRoot(), file),
  });
}

export async function POST(req: Request) {
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return Response.json({ error: "expected multipart form data" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof File)) return Response.json({ error: "no file" }, { status: 400 });

  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED.has(ext)) {
    return Response.json(
      { error: `Unsupported file type "${ext || "unknown"}". Use PDF, DOCX, DOC, RTF or TXT.` },
      { status: 415 },
    );
  }
  if (file.size === 0) return Response.json({ error: "That file is empty." }, { status: 400 });
  if (file.size > MAX_BYTES) {
    return Response.json({ error: "That file is over 10 MB." }, { status: 413 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());
  // A PDF that is not a PDF would be attached to a real application, so check
  // the magic bytes rather than trusting the extension.
  if (ext === ".pdf" && bytes.subarray(0, 5).toString("latin1") !== "%PDF-") {
    return Response.json({ error: "That does not look like a real PDF." }, { status: 415 });
  }

  try {
    fs.mkdirSync(dir(), { recursive: true });
    // Only one résumé is kept: drop any previous extension so uploading a DOCX
    // over a PDF cannot leave two files racing to be "the" résumé.
    for (const e of ALLOWED) {
      const old = path.join(dir(), BASE + e);
      if (fs.existsSync(old)) fs.rmSync(old);
    }
    const dest = path.join(dir(), BASE + ext);
    const tmp = dest + ".tmp";
    fs.writeFileSync(tmp, bytes);
    fs.renameSync(tmp, dest);
    return Response.json({ ok: true, name: path.basename(dest), size: bytes.length });
  } catch (e) {
    return Response.json(
      { error: e instanceof Error ? e.message : "could not save the file" },
      { status: 500 },
    );
  }
}

export async function DELETE() {
  const file = storedResume();
  if (file) {
    try {
      fs.rmSync(file);
    } catch {
      return Response.json({ error: "could not remove the file" }, { status: 500 });
    }
  }
  return Response.json({ ok: true });
}
