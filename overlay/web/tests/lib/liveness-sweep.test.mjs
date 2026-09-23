// The liveness sweep rewrites data/pipeline.md, so its edit is pinned here.
// Run: node --test tests/lib/liveness-sweep.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { closeEntries, htmlToText, pendingEntries } from "../../src/lib/core/pipeline-close.mjs";

const key = (u) => u.trim().toLowerCase();
const FILE = `# Pipeline

## Pending
- [ ] https://a.test/1 | Acme | Backend | Remote | posted: 2026-09-20
- [ ] https://a.test/2 | Acme | Platform
- [ ] ~~https://a.test/3 | Old | Gone~~
- [x] https://a.test/4 | Done | Role

## Processed
- [x] #1 | https://a.test/9 | Co | Role | 4.1/5
`;

test("pendingEntries: open rows only", () => {
  assert.deepEqual(pendingEntries(FILE).map((e) => e.url), ["https://a.test/1", "https://a.test/2"]);
});

test("closeEntries moves a closed row under Processed, struck, and nothing else changes", () => {
  const out = closeEntries(FILE, new Set(["https://a.test/2"]), key);
  assert.equal(
    out,
    FILE.replace("- [ ] https://a.test/2 | Acme | Platform\n", "").replace(
      "## Processed\n",
      "## Processed\n- [x] ~~https://a.test/2 | Acme | Platform~~ — posting expired (liveness sweep)\n",
    ),
  );
  assert.equal(closeEntries(FILE, new Set(["https://nope"]), key), FILE);
});

test("closeEntries creates Processed when missing", () => {
  const out = closeEntries("## Pending\n- [ ] https://a.test/1 | A | R\n\n", new Set(["https://a.test/1"]), key);
  assert.equal(out, "## Pending\n\n## Processed\n- [x] ~~https://a.test/1 | A | R~~ — posting expired (liveness sweep)\n");
});

test("htmlToText ignores closure strings inside scripts", () => {
  const t = htmlToText('<div id="root"></div><script>window.i18n={"x":"This job has expired"}</script><p>Hi&nbsp;there</p>');
  assert.equal(t, "Hi there");
});
