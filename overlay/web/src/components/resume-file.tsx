"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, FileText, Loader2, Paperclip, Trash2, Upload } from "lucide-react";

// The résumé the candidate already has. The apply flow attaches a tailored CV
// when career-ops generated one for that company, and this file otherwise — so
// a "Resume/CV" upload field on a real application is never left empty.
// Attaching is not submitting: the form still stops for the human.

type Stored = { exists: boolean; name?: string; size?: number; updated?: string; path?: string };

const ACCEPT = ".pdf,.docx,.doc,.rtf,.txt";

const prettySize = (n?: number) =>
  n == null ? "" : n < 1024 * 1024 ? `${Math.round(n / 1024)} KB` : `${(n / 1024 / 1024).toFixed(1)} MB`;

export function ResumeFile() {
  const [stored, setStored] = useState<Stored>({ exists: false });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [over, setOver] = useState(false);
  const [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const refresh = () =>
    fetch("/api/resume")
      .then((r) => r.json())
      .then(setStored)
      .catch(() => {})
      .finally(() => setLoaded(true));

  useEffect(() => {
    void refresh();
  }, []);

  const upload = async (file: File) => {
    setBusy(true);
    setError("");
    try {
      const form = new FormData();
      form.append("file", file);
      const res = await fetch("/api/resume", { method: "POST", body: form });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "upload failed");
      await refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "upload failed");
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    setError("");
    try {
      await fetch("/api/resume", { method: "DELETE" });
      await refresh();
    } catch {
      setError("could not remove it");
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="mt-10">
      <h2 className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        <Paperclip className="size-3.5" /> Résumé to attach
      </h2>
      <p className="mb-4 text-sm text-muted">
        The finished file you already send to employers. When an application form has a
        Resume/CV upload, this is attached for you — unless career-ops generated a tailored
        CV for that company, which wins. It is still never submitted: you review the filled
        form and press the button yourself.
      </p>

      <div
        onDragOver={(e) => {
          e.preventDefault();
          setOver(true);
        }}
        onDragLeave={() => setOver(false)}
        onDrop={(e) => {
          e.preventDefault();
          setOver(false);
          const f = e.dataTransfer.files?.[0];
          if (f) void upload(f);
        }}
        className={`rounded-2xl border p-5 transition-colors ${
          over ? "border-brand/60 bg-brand-soft" : "border-border bg-surface/40"
        }`}
      >
        {!loaded ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : stored.exists ? (
          <div className="flex flex-wrap items-center gap-3">
            <FileText className="size-5 shrink-0 text-brand" />
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-medium text-foreground">{stored.name}</p>
              <p className="text-xs text-faint">
                {prettySize(stored.size)}
                {stored.updated ? ` · uploaded ${new Date(stored.updated).toLocaleDateString()}` : ""}
                {stored.path ? ` · ${stored.path}` : ""}
              </p>
            </div>
            <a
              href="/api/resume/file"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-brand/50 hover:text-brand-text"
            >
              <ExternalLink className="size-3.5" /> View
            </a>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-brand/50 hover:text-brand-text disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Upload className="size-3.5" />}
              Replace
            </button>
            <button
              type="button"
              onClick={remove}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full border border-transparent px-3 py-1.5 text-xs font-medium text-muted transition-colors hover:text-amber-700 disabled:opacity-60 dark:hover:text-amber-400"
            >
              <Trash2 className="size-3.5" /> Remove
            </button>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="text-sm text-foreground">No résumé uploaded yet.</p>
              <p className="text-xs text-faint">
                Drop a file here, or browse. PDF, DOCX, DOC, RTF or TXT, up to 10 MB.
              </p>
            </div>
            <button
              type="button"
              onClick={() => fileRef.current?.click()}
              disabled={busy}
              className="inline-flex items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-60"
            >
              {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />}
              Upload résumé
            </button>
          </div>
        )}

        <input
          ref={fileRef}
          type="file"
          accept={ACCEPT}
          hidden
          onChange={(e) => e.target.files?.[0] && void upload(e.target.files[0])}
        />
        {error && <p className="mt-3 text-sm text-amber-700 dark:text-amber-400">{error}</p>}
      </div>
    </section>
  );
}
