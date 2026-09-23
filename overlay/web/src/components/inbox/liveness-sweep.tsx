"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { usePipeline } from "@/components/pipeline/pipeline-provider";

type Closed = { url: string; company: string; role: string; reason: string };

// One sweep per page load, shared by every mount: React dev mode mounts twice,
// and a second sweep would find nothing left to report.
let sweep: Promise<Closed[]> | null = null;
async function runSweep(): Promise<Closed[]> {
  const all: Closed[] = [];
  for (let round = 0; round < 10; round++) {
    const r = await fetch("/api/pipeline/liveness", { method: "POST" }).catch(() => null);
    const d = r?.ok ? await r.json().catch(() => null) : null;
    if (!d) break;
    all.push(...(d.closed ?? []));
    if (!d.remaining || !d.checked) break;
  }
  return all;
}

/**
 * When the app opens, check every inbox posting is still open and move the
 * closed ones out, so nothing on screen points at a dead job. Runs once per
 * page load; the server skips postings checked in the last 12 hours.
 */
export function LivenessSweep() {
  const router = useRouter();
  const { refetch } = usePipeline();
  const [closed, setClosed] = useState<Closed[]>([]);

  useEffect(() => {
    let stop = false;
    (sweep ??= runSweep()).then((all) => {
      if (stop || !all.length) return;
      setClosed(all);
      refetch();
      router.refresh();
      // Today's "fresh matches" listens for this to refetch.
      window.dispatchEvent(new CustomEvent("co-job-done", { detail: { kind: "liveness" } }));
    });
    return () => {
      stop = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!closed.length) return;
    const t = setTimeout(() => setClosed([]), 12_000);
    return () => clearTimeout(t);
  }, [closed]);

  if (!closed.length) return null;
  const n = closed.length;
  return (
    <div role="status" className="fixed inset-x-0 bottom-6 z-40 flex justify-center px-4">
      <div className="flex max-w-md items-start gap-3 rounded-2xl border border-border bg-surface px-4 py-3 text-sm shadow-lg">
        <div className="min-w-0">
          <p className="font-medium text-foreground">
            Removed {n} closed posting{n === 1 ? "" : "s"} from your inbox
          </p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted">
            {closed.slice(0, 4).map((c) => (
              <li key={c.url} className="truncate">
                {c.company} · {c.role}
              </li>
            ))}
            {n > 4 && <li>and {n - 4} more</li>}
          </ul>
        </div>
        <button type="button" aria-label="Dismiss" onClick={() => setClosed([])} className="text-faint hover:text-foreground max-sm:min-h-[44px]">
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}
