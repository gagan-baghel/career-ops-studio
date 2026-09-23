// The web runs every Explore source under CAREER_OPS_SCAN_BUDGET_MS so one slow
// Workday tenant cannot hold a scan past the request's lifetime.
// Run: node --test tests/scan-ats-full-budget.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const { scanBudget } = await import(pathToFileURL(join(ROOT, "scan-ats-full.mjs")).href);

test("no budget: never spent, the engine's 5-minute per-company watchdog", () => {
  for (const env of [{}, { CAREER_OPS_SCAN_BUDGET_MS: "" }, { CAREER_OPS_SCAN_BUDGET_MS: "nope" }, { CAREER_OPS_SCAN_BUDGET_MS: "-5" }]) {
    const b = scanBudget(env);
    assert.equal(b.spent(), false);
    assert.equal(b.companyTimeoutMs(), 300_000);
  }
});

test("a budget clamps each company to the time left, and is spent at the deadline", () => {
  const b = scanBudget({ CAREER_OPS_SCAN_BUDGET_MS: "60000" });
  assert.equal(b.spent(), false);
  assert.ok(b.companyTimeoutMs() <= 60_050 && b.companyTimeoutMs() > 59_000);
  const past = scanBudget({ CAREER_OPS_SCAN_BUDGET_MS: "1000" }, Date.now() - 5_000);
  assert.equal(past.spent(), true);
  assert.equal(past.companyTimeoutMs(), 1_000); // floor, never 0 or negative
});
