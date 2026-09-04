"use client";

import { useEffect, useState } from "react";
import { Check, Loader2, User, Wallet } from "lucide-react";

// config/profile.yml's candidate + compensation blocks. The merge-safe writer
// behind /api/profile already existed; only the assistant could reach it. This
// form edits what is on disk — it loads first, so a save can never merge blank
// placeholders over fields it did not show.

type Fields = {
  name: string;
  email: string;
  phone: string;
  location: string;
  linkedin: string;
  github: string;
  portfolio: string;
  compRange: string;
  currency: string;
  compMinimum: string;
  remote: string;
};

const EMPTY: Fields = {
  name: "", email: "", phone: "", location: "", linkedin: "", github: "",
  portfolio: "", compRange: "", currency: "", compMinimum: "", remote: "",
};

const INPUT =
  "w-full rounded-xl border border-border bg-surface/60 px-3 py-2 text-sm outline-none transition-colors placeholder:text-faint focus:border-brand/50";

function Field({
  label, value, onChange, placeholder, hint, wide, multiline,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  wide?: boolean;
  multiline?: boolean;
}) {
  return (
    <div className={wide ? "sm:col-span-2" : undefined}>
      <label className="mb-1.5 block text-xs font-medium text-muted">{label}</label>
      {multiline ? (
        <textarea
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          rows={2}
          className={`${INPUT} resize-y leading-relaxed`}
        />
      ) : (
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className={INPUT}
        />
      )}
      {hint && <p className="mt-1 text-xs text-faint">{hint}</p>}
    </div>
  );
}

export function ProfileForm() {
  const [f, setF] = useState<Fields>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [missing, setMissing] = useState(false);
  const [state, setState] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [error, setError] = useState("");

  const set = (k: keyof Fields) => (v: string) => setF((prev) => ({ ...prev, [k]: v }));

  useEffect(() => {
    fetch("/api/profile")
      .then((r) => r.json())
      .then((d) => {
        if (d?.error) { setError(d.error); setState("error"); return; }
        if (d?.exists === false) { setMissing(true); return; }
        setF({ ...EMPTY, ...Object.fromEntries(Object.keys(EMPTY).map((k) => [k, d[k] ?? ""])) } as Fields);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const submit = async () => {
    setState("saving");
    setError("");
    try {
      const res = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(f),
      });
      const d = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(d?.error || "save failed");
      setState("saved");
      setMissing(false);
      setTimeout(() => setState("idle"), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
      setState("error");
    }
  };

  return (
    <section>
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted">Profile</h2>
      <p className="mb-4 text-sm text-muted">
        Who you are and what you are looking for. Saved to{" "}
        <code className="font-mono text-xs">config/profile.yml</code> — the same file evaluations,
        CVs and application emails read.
      </p>

      <div className="space-y-6 rounded-2xl border border-border bg-surface/40 p-5">
        {missing && (
          <p className="rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-sm text-amber-700 dark:text-amber-400">
            No profile yet — saving creates one from the example template.
          </p>
        )}

        <div>
          <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            <User className="size-3.5" /> Contact
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Full name" value={f.name} onChange={set("name")} placeholder="Jane Smith" />
            <Field label="Email" value={f.email} onChange={set("email")} placeholder="jane@example.com" />
            <Field label="Phone" value={f.phone} onChange={set("phone")} placeholder="+1 555 000 0000" />
            <Field label="Where you live" value={f.location} onChange={set("location")} placeholder="Berlin, Germany" />
            <Field label="LinkedIn" value={f.linkedin} onChange={set("linkedin")} placeholder="linkedin.com/in/jane" />
            <Field label="GitHub" value={f.github} onChange={set("github")} placeholder="github.com/jane" />
            <Field label="Portfolio" value={f.portfolio} onChange={set("portfolio")} placeholder="https://jane.dev" wide />
          </div>
        </div>

        <div>
          <h3 className="mb-3 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
            <Wallet className="size-3.5" /> Compensation
          </h3>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field
              label="Target range"
              value={f.compRange}
              onChange={set("compRange")}
              placeholder="18-30 LPA"
              hint="Free text — keep your own unit (LPA, €, $120K–$160K)."
            />
            <Field label="Currency" value={f.currency} onChange={set("currency")} placeholder="INR" />
            <Field
              label="Walk-away minimum"
              value={f.compMinimum}
              onChange={set("compMinimum")}
              placeholder="15 LPA"
              hint="The number below which you decline."
            />
            <Field
              label="Work location flexibility"
              multiline
              wide
              value={f.remote}
              onChange={set("remote")}
              placeholder="Remote, or hybrid in Pune"
              hint="Feeds evaluation and negotiation; separate from the scan filter above."
            />
          </div>
        </div>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={!loaded || state === "saving"}
            className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-60"
          >
            {state === "saving" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save profile
          </button>
          {state === "saved" && (
            <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved to config/profile.yml</span>
          )}
          {state === "error" && <span className="text-sm text-amber-700 dark:text-amber-400">{error}</span>}
        </div>

        <p className="text-xs text-faint">
          Only these fields are written; your archetypes, narrative and proof points are merged
          around them untouched. Saving reformats the YAML and drops its comments, and writes a
          timestamped <span className="font-mono">.bak</span> next to it first.
        </p>
      </div>
    </section>
  );
}
