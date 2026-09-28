import assert from "node:assert/strict";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

process.env.CUSAGE_CACHE_DIR = mkdtempSync(join(tmpdir(), "cusage-test-"));
const { planName, readLive, rows, saveLive, withLive } = await import("../src/usage.mjs");
const { sample, usage } = await import("./fixture.mjs");

test("rows come from the limits array", () => {
  const r = rows(sample());
  assert.deepEqual(r.map((x) => [x.label, x.pct]), [["Session", 42], ["Weekly", 18], ["Opus wk", 7]]);
  assert.equal(r[0].windowMs, 5 * 3600e3);
});

test("rows fall back to the older five_hour / seven_day fields", () => {
  const { limits, ...legacy } = sample();
  assert.deepEqual(rows(legacy).map((x) => x.label), ["Session", "Weekly"]);
});

test("plan name", () => {
  assert.equal(planName({ subscriptionType: "max", rateLimitTier: "default_claude_max_20x" }), "Claude Max 20x");
  assert.equal(planName({ subscriptionType: "pro" }), "Claude Pro");
  assert.equal(planName({}), "Claude");
});

test("live numbers override older API numbers", () => {
  const u = usage({}, 60_000);
  const reset = Math.floor(Date.now() / 1000) + 3600;
  saveLive({ five_hour: { used_percentage: 77, resets_at: reset }, seven_day: { used_percentage: 30 } });
  const merged = withLive(u);
  const byLabel = Object.fromEntries(rows(merged.data).map((x) => [x.label, x.pct]));
  assert.deepEqual(byLabel, { Session: 77, Weekly: 30, "Opus wk": 7 });
  assert.equal(merged.data.five_hour.utilization, 77);
  assert.ok(merged.fetchedAt > u.fetchedAt);
  assert.equal(u.data.five_hour.utilization, 42, "original is not mutated");
});

test("older live numbers are ignored", () => {
  const u = usage();
  const live = { at: Date.now() - 60_000, five_hour: { pct: 99, resetsAt: null } };
  assert.equal(withLive(u, live), u);
});

test("expired live windows are ignored", () => {
  const live = { at: Date.now(), five_hour: { pct: 99, resetsAt: Date.now() - 1000 } };
  assert.equal(rows(withLive(usage({}, 60_000), live).data)[0].pct, 42);
});

test("a fresh live snapshot hides a rate-limit warning", () => {
  const u = { ...usage({}, 60_000), warning: "rate limited", error: { status: 429 } };
  saveLive({ five_hour: { used_percentage: 50 } });
  assert.equal(withLive(u).warning, undefined);
});

test("empty rate_limits are not saved", () => {
  saveLive({ five_hour: { used_percentage: 12 } });
  assert.equal(saveLive({}), null);
  assert.equal(readLive().five_hour.pct, 12);
});
