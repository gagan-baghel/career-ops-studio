import path from "node:path";
import * as yaml from "js-yaml";
import { careerOpsRoot } from "@/lib/career-ops";
import { atomicWriteWithBackup } from "@/lib/core/safe-write";
import { loadPortalsDocument, mergePortalFilters, PortalsConfigError } from "@/lib/portals-config.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Merge-safe writer for portals.yml's web-owned filters (a USER-LAYER file).
// Replaces title_filter.positive and, when provided, location_filter.allow;
// seeds from templates/portals.example.yml on first create; and PRESERVES
// tracked_companies plus every other block. Atomic write, confirm-gated
// (setProfile/setPortals). This loads the first home scan after role confirmation.

// Read the two web-owned filters back so a form can show what is actually in
// portals.yml rather than starting blank and silently clobbering it on save.
// The shipped portals.example.yml already carries 30 roles, so a cap of 24
// silently deleted six of them the moment anything re-saved the file — which the
// targeting form does on every location edit. The cap exists to bound the scan,
// not to trim an existing config, so it sits above the template's own size.
const ROLE_CAP = 120;

export async function GET() {
  const root = careerOpsRoot();
  try {
    const { doc } = loadPortalsDocument(
      path.join(root, "portals.yml"),
      path.join(root, "templates", "portals.example.yml"),
    );
    const strings = (v: unknown) =>
      Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [];
    const titleFilter = doc.title_filter as Record<string, unknown> | undefined;
    const locationFilter = doc.location_filter as Record<string, unknown> | undefined;
    return Response.json({
      roles: strings(titleFilter?.positive),
      locations: strings(locationFilter?.allow),
    });
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "could not read portals.yml" },
      { status: 500 },
    );
  }
}

export async function POST(req: Request) {
  let body: {
    roles?: string[];
    location?: string[];
    negative?: string[];
    block?: string[];
    alwaysAllow?: string[];
    blockHard?: string[];
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return Response.json({ error: "bad json" }, { status: 400 });
  }
  const roles = (Array.isArray(body.roles) ? body.roles : []).map((r) => String(r).trim()).filter(Boolean).slice(0, ROLE_CAP);
  if (roles.length === 0) return Response.json({ error: "no roles" }, { status: 400 });

  const root = careerOpsRoot();
  const file = path.join(root, "portals.yml");
  let doc: Record<string, unknown>;
  try {
    ({ doc } = loadPortalsDocument(file, path.join(root, "templates", "portals.example.yml")));
  } catch (error) {
    const invalidUserConfig = error instanceof PortalsConfigError && error.kind === "invalid-user-config";
    return Response.json(
      { error: error instanceof Error ? error.message : "could not load portals.yml" },
      { status: invalidUserConfig ? 409 : 500 },
    );
  }

  const locations = Array.isArray(body.location)
    ? body.location.map((l) => String(l).trim()).filter(Boolean)
    : undefined;
  doc = mergePortalFilters(doc, roles, locations);

  // mergePortalFilters only handles title_filter.positive and location_filter.allow,
  // and only *sets* allow when the list is non-empty. Everything else the Explore
  // filter bar can express — exclusions, blocked and always-allowed locations —
  // had no way to persist, and an explicitly emptied list would silently keep the
  // old restriction. setList covers both: present-and-empty clears the key.
  const setList = (blockName: "title_filter" | "location_filter", key: string, values?: string[]) => {
    if (!Array.isArray(values)) return;
    const clean = values.map((v) => String(v).trim()).filter(Boolean);
    const current = (doc[blockName] ?? {}) as Record<string, unknown>;
    const next = { ...current };
    if (clean.length) next[key] = clean;
    else delete next[key];
    if (Object.keys(next).length) doc[blockName] = next;
    else delete doc[blockName];
  };

  setList("location_filter", "allow", body.location);
  setList("title_filter", "negative", body.negative);
  setList("location_filter", "block", body.block);
  setList("location_filter", "always_allow", body.alwaysAllow);
  setList("location_filter", "block_hard", body.blockHard);

  try {
    atomicWriteWithBackup(file, yaml.dump(doc, { lineWidth: 100, noRefs: true }));
  } catch (e) {
    return Response.json({ error: e instanceof Error ? e.message : "write failed" }, { status: 500 });
  }
  return Response.json({ ok: true, roles: roles.length });
}
