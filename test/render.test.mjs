import assert from "node:assert/strict";
import { test } from "node:test";
import { ago, bar, render, renderLine, statusSegment, stripAnsi, theme, until } from "../src/render.mjs";
import { usage } from "./fixture.mjs";

const HOUR = 3600e3;

test("no line is wider than the terminal, at any width or height", () => {
  const u = { ...usage({ session: 95, weekly: 72 }), warning: "Usage API rate limited (429). Showing cached numbers." };
  for (let cols = 12; cols <= 160; cols++) {
    for (const height of [8, 14, 40]) {
      for (const watch of [false, true]) {
        const out = stripAnsi(render(u, { cols, height, watch }));
        for (const line of out.split("\n"))
          assert.ok(line.length <= cols, `cols=${cols} height=${height}: ${JSON.stringify(line)} is ${line.length} wide`);
      }
    }
  }
});

test("wide panes use one row per limit, narrow panes stack", () => {
  const u = usage();
  const wide = stripAnsi(render(u, { cols: 100, color: false }));
  assert.match(wide, /Session\s+█+.*42%\s+in 3h 0m/);
  const narrow = stripAnsi(render(u, { cols: 40, color: false })).split("\n");
  const i = narrow.findIndex((l) => l.includes("Session"));
  assert.match(narrow[i], /Session\s+42%$/);
  assert.match(narrow[i + 1], /^ [█┃░]{38}$/);
  assert.match(narrow[i + 2], /resets in 3h 0m/);
});

test("header shows the plan and how old the numbers are", () => {
  const out = stripAnsi(render(usage({}, 30_000), { cols: 60, color: false }));
  assert.match(out.split("\n")[0], /Claude Max 5x\s+updated 30s ago/);
});

test("stale numbers turn the header yellow", () => {
  const fresh = render(usage({}, 10_000), { cols: 60 }).split("\n")[0];
  const stale = render(usage({}, 10 * 60_000), { cols: 60 }).split("\n")[0];
  assert.ok(!fresh.includes("\x1b[33m"));
  assert.ok(stale.includes("\x1b[33m"));
});

test("per-model limits get their own row", () => {
  assert.match(stripAnsi(render(usage(), { cols: 100 })), /Opus wk .* 7%/);
});

test("the bar has the right fill and a pace tick", () => {
  const t = theme(false);
  // 2.5h into a 5h window with 25% used: tick in the middle, quarter filled.
  const b = bar(25, Date.now() + 2.5 * HOUR, 5 * HOUR, 20, t);
  assert.equal(b, "█████░░░░░┃░░░░░░░░░");
  assert.equal(bar(150, null, null, 10, t), "██████████");
  assert.equal(bar(0, null, null, 4, t), "░░░░");
});

test("time formatting", () => {
  assert.equal(until(Date.now() + 90 * 60e3 + 5e3), "1h 30m");
  assert.equal(until(Date.now() + 2 * 24 * HOUR + 3 * HOUR + 5e3), "2d 3h");
  assert.equal(until(Date.now() - 1), "now");
  assert.equal(ago(Date.now() - 2_000), "just now");
  assert.equal(ago(Date.now() - 42_000), "42s ago");
  assert.equal(ago(Date.now() - 5 * 60_000), "5m ago");
});

test("one-line summary", () => {
  assert.equal(renderLine(usage(), { color: false }), "S 42% 3h 0m │ W 18% 4d 0h");
});

test("status-line segment from Claude Code's rate_limits", () => {
  const now = Math.floor(Date.now() / 1000);
  const rl = { five_hour: { used_percentage: 23.5, resets_at: now + 7200 + 5 }, seven_day: { used_percentage: 41.2 } };
  assert.equal(statusSegment(rl, { color: false }), "5h 24% 2h 0m · wk 41%");
  assert.equal(statusSegment(undefined, { color: false }), "");
});
