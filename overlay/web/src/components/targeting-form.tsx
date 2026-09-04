"use client";

import { useEffect, useState } from "react";
import { Briefcase, Check, Loader2, MapPin, X } from "lucide-react";
import { cleanChips } from "@/lib/explore";

// The roles + locations the portal scanner actually uses. Both live in
// portals.yml (title_filter.positive / location_filter.allow) and were already
// wired end to end — API, merge-safe writer, CLI scanner — but reachable only by
// asking the assistant to do it. This is the form for them.

type Save = "idle" | "saving" | "saved" | "error";

function ChipField({
  values,
  onChange,
  placeholder,
  label,
  icon,
}: {
  values: string[];
  onChange: (v: string[]) => void;
  placeholder: string;
  label: string;
  icon: React.ReactNode;
}) {
  const [draft, setDraft] = useState("");

  // Split on unambiguous separators only — never bare spaces, which belong
  // inside "New York" or "Senior Backend Engineer".
  const commit = (text: string) => {
    if (!text.trim()) return;
    onChange(cleanChips([...values, ...text.split(/[,\n;\t\r]+/)]));
    setDraft("");
  };

  return (
    <div>
      <label className="mb-2 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-[0.18em] text-muted">
        {icon} {label}
      </label>
      <div className="flex min-h-[2.75rem] flex-wrap items-center gap-1.5 rounded-xl border border-border bg-surface/40 px-2 py-2 transition-colors focus-within:border-brand/40">
        {values.map((v) => (
          <span
            key={v}
            className="inline-flex items-center gap-1 rounded-full border border-brand/25 bg-brand-soft px-2 py-0.5 text-[12.5px] text-brand-text"
          >
            {v}
            <button
              type="button"
              onClick={() => onChange(values.filter((x) => x !== v))}
              aria-label={`Remove ${v}`}
              className="opacity-60 transition-opacity hover:opacity-100"
            >
              <X className="size-3" />
            </button>
          </span>
        ))}
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit(draft);
            } else if (e.key === "Backspace" && !draft && values.length) {
              onChange(values.slice(0, -1));
            }
          }}
          onBlur={() => commit(draft)}
          placeholder={values.length ? "" : placeholder}
          className="min-w-[8rem] flex-1 bg-transparent text-sm outline-none placeholder:text-faint"
        />
      </div>
    </div>
  );
}

export function TargetingForm() {
  const [roles, setRoles] = useState<string[]>([]);
  const [locations, setLocations] = useState<string[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [save, setSave] = useState<Save>("idle");
  const [error, setError] = useState("");

  useEffect(() => {
    fetch("/api/portals")
      .then((r) => r.json())
      .then((d) => {
        if (Array.isArray(d?.roles)) setRoles(d.roles);
        if (Array.isArray(d?.locations)) setLocations(d.locations);
      })
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  const submit = async () => {
    if (!roles.length) {
      setError("Add at least one target role — the scanner needs something to match.");
      setSave("error");
      return;
    }
    setSave("saving");
    setError("");
    try {
      const res = await fetch("/api/portals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        // Always send location, even empty: that is how the filter gets cleared.
        body: JSON.stringify({ roles, location: locations }),
      });
      if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error || "save failed");
      setSave("saved");
      setTimeout(() => setSave("idle"), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : "save failed");
      setSave("error");
    }
  };

  return (
    <section className="mt-12">
      <h2 className="mb-2 text-xs font-semibold uppercase tracking-[0.18em] text-muted">Targeting</h2>
      <p className="mb-4 text-sm text-muted">
        What the portal scanner looks for. Saved to <code className="font-mono text-xs">portals.yml</code>,
        so the CLI (<code className="font-mono text-xs">npm run scan</code>) and this app use the same targets.
      </p>

      <div className="space-y-5 rounded-2xl border border-border bg-surface/40 p-5">
        <ChipField
          label="Target roles"
          icon={<Briefcase className="size-3.5" />}
          values={roles}
          onChange={setRoles}
          placeholder="Senior Backend Engineer, AI Engineer…"
        />
        <ChipField
          label="Locations"
          icon={<MapPin className="size-3.5" />}
          values={locations}
          onChange={setLocations}
          placeholder="Remote, Berlin, Germany… (empty = anywhere)"
        />
        <p className="text-xs text-faint">
          A location matches on substring, so <span className="font-mono">Germany</span> keeps every German
          city and <span className="font-mono">Remote</span> keeps remote listings. Leave it empty to stop
          filtering by location entirely.
        </p>
        <p className="text-xs text-faint">
          {roles.length} role{roles.length === 1 ? "" : "s"} · {locations.length || "no"} location
          {locations.length === 1 ? "" : "s"}. Saving rewrites <span className="font-mono">portals.yml</span>{" "}
          and drops its explanatory comments; your companies and queries are kept, and a timestamped{" "}
          <span className="font-mono">.bak</span> is written next to it every time.
        </p>

        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={submit}
            disabled={!loaded || save === "saving"}
            className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-medium text-brand-foreground transition-colors hover:bg-brand-200 disabled:opacity-60"
          >
            {save === "saving" ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}
            Save targeting
          </button>
          {save === "saved" && <span className="text-sm text-emerald-600 dark:text-emerald-400">Saved to portals.yml</span>}
          {save === "error" && <span className="text-sm text-amber-700 dark:text-amber-400">{error}</span>}
        </div>
      </div>
    </section>
  );
}
