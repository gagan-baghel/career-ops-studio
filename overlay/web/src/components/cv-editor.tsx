"use client";

import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, Loader2, Upload, X } from "lucide-react";
import { CvIngest } from "@/components/cv/cv-ingest";
import { ResumeFile } from "@/components/resume-file";
import { cn } from "@/lib/cn";

export function CvEditor() {
  const [content, setContent] = useState("");
  const [loaded, setLoaded] = useState(false);
  const [exists, setExists] = useState(true);
  // Importing REPLACES cv.md, so it lives behind an explicit toggle rather than
  // sitting open next to the editor where a stray drop could overwrite a CV.
  const [importing, setImporting] = useState(false);
  // Parsing turns the PDF into cv.md text and drops the file. Ticked, the same
  // upload is also kept as-is for attaching to application forms.
  const [keepFile, setKeepFile] = useState(true);
  const [kept, setKept] = useState("");
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    fetch("/api/cv")
      .then((r) => r.json())
      .then((d) => {
        setContent(d.content ?? "");
        setExists(d.exists ?? false);
      })
      .finally(() => setLoaded(true));
  }, []);

  async function save() {
    setSaving(true);
    try {
      const res = await fetch("/api/cv", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ content }),
      });
      if (res.ok) {
        setDirty(false);
        setExists(true);
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-6xl px-6 py-8">
      <div className="flex items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-2xl tracking-tight text-landing">CV editor</h1>
          <p className="mt-1 text-sm text-muted">
            Edit <code className="text-foreground">cv.md</code> with live preview.
            {!exists && loaded && <span className="ml-1 text-faint">No cv.md yet — start typing to create it.</span>}
          </p>
        </div>
        <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => setImporting((v) => !v)}
          className="inline-flex items-center justify-center gap-2 rounded-full border border-border bg-surface px-4 py-2 text-sm font-medium text-muted transition-colors hover:text-foreground max-sm:min-h-[44px]"
        >
          {importing ? <X className="size-4" /> : <Upload className="size-4" />}
          {importing ? "Cancel import" : "Import from PDF"}
        </button>
        <button
          type="button"
          onClick={save}
          disabled={saving || !dirty}
          className={cn(
            "inline-flex items-center justify-center gap-2 rounded-full px-5 py-2 text-sm font-medium transition-colors max-sm:min-h-[44px]",
            dirty
              ? "bg-brand text-brand-foreground hover:bg-brand-200"
              : "border border-border bg-surface text-muted",
          )}
        >
          {saving ? <Loader2 className="size-4 animate-spin" /> : saved ? <Check className="size-4" /> : null}
          {saved ? "Saved" : "Save"}
        </button>
        </div>
      </div>

      {importing && (
        <div className="mt-6 rounded-2xl border border-border bg-surface/40 p-5">
          <p className="mb-4 text-sm text-muted">
            Drop a PDF, .docx, .md or .txt — or paste the text. Your CV is parsed by the AI
            CLI on this machine and never uploaded anywhere. You review the markdown before
            anything is written, and{" "}
            {exists ? (
              <>saving replaces your current <code className="text-foreground">cv.md</code>{" "}
              (the previous one is kept as a timestamped <code className="text-foreground">.bak</code>).</>
            ) : (
              <>saving creates your <code className="text-foreground">cv.md</code>.</>
            )}
          </p>
          <label className="mb-4 flex cursor-pointer items-start gap-2 text-sm text-muted">
            <input
              type="checkbox"
              checked={keepFile}
              onChange={(e) => setKeepFile(e.target.checked)}
              className="mt-0.5 size-4 accent-[var(--color-brand)]"
            />
            <span>
              Also keep this file as my <strong className="text-foreground">résumé to attach</strong> —
              the original PDF is stored untouched and sent to application forms. Without this,
              parsing only produces the <code className="text-foreground">cv.md</code> text and the
              file is discarded.
            </span>
          </label>
          {kept && <p className="mb-4 text-sm text-emerald-600 dark:text-emerald-400">{kept}</p>}
          <CvIngest
            onFile={(file) => {
              if (!keepFile) return;
              const form = new FormData();
              form.append("file", file);
              fetch("/api/resume", { method: "POST", body: form })
                .then((r) => r.json())
                .then((d) => setKept(d?.ok ? `Kept ${file.name} as your résumé to attach.` : d?.error || ""))
                .catch(() => {});
            }}
            onSaved={() => {
              setImporting(false);
              setDirty(false);
              // Pull the freshly written cv.md back into the editor.
              fetch("/api/cv")
                .then((r) => r.json())
                .then((d) => {
                  if (typeof d?.content === "string") setContent(d.content);
                  setExists(true);
                })
                .catch(() => {});
            }}
          />
        </div>
      )}

      {!loaded ? (
        <div className="mt-6 text-sm text-muted">Loading…</div>
      ) : (
        <div className="mt-6 grid gap-4 lg:grid-cols-2">
          <textarea
            value={content}
            onChange={(e) => {
              setContent(e.target.value);
              setDirty(true);
            }}
            spellCheck={false}
            placeholder="# Your Name&#10;&#10;## Summary&#10;..."
            className="min-h-[60vh] w-full resize-none rounded-2xl border border-border bg-surface/50 p-4 font-mono text-sm leading-relaxed outline-none transition-colors placeholder:text-faint focus:border-brand/40"
          />
          <article className="report-prose min-h-[60vh] overflow-auto rounded-2xl border border-border bg-surface/30 p-5">
            {content.trim() ? (
              <ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
            ) : (
              <p className="text-muted">Preview appears here.</p>
            )}
          </article>
        </div>
      )}
      <ResumeFile />
    </div>
  );
}
