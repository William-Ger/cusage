import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { test } from "node:test";

const BIN = fileURLToPath(new URL("../bin/cusage.mjs", import.meta.url));
const dir = mkdtempSync(join(tmpdir(), "cusage-cli-"));
const env = {
  ...process.env,
  NO_COLOR: "1",
  CUSAGE_CACHE_DIR: join(dir, "cache"),
  XDG_CONFIG_HOME: join(dir, "config"),
  CLAUDE_CONFIG_DIR: join(dir, "claude"),
};
const run = (args, input) => spawnSync(process.execPath, [BIN, ...args], { input, env, encoding: "utf8" });

const reset = Math.floor(Date.now() / 1000) + 3600 + 5;
const payload = JSON.stringify({
  model: { display_name: "Opus" },
  rate_limits: { five_hour: { used_percentage: 12, resets_at: reset }, seven_day: { used_percentage: 34 } },
});

test("statusline prints the segment and saves live numbers", () => {
  const r = run(["statusline"], payload);
  assert.equal(r.status, 0);
  assert.equal(r.stdout.trim(), "5h 12% 1h 0m · wk 34%");
  const live = JSON.parse(readFileSync(join(dir, "cache", "live.json"), "utf8"));
  assert.equal(live.five_hour.pct, 12);
  assert.equal(live.seven_day.pct, 34);
});

test("the old --statusline flag still works", () => {
  assert.equal(run(["--statusline"], payload).stdout.trim(), "5h 12% 1h 0m · wk 34%");
});

test("statusline appends to a wrapped status line", () => {
  mkdirSync(join(dir, "config", "cusage"), { recursive: true });
  const wrap = { type: "command", command: `node -e "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>console.log('['+JSON.parse(s).model.display_name+']'))"` };
  writeFileSync(join(dir, "config", "cusage", "config.json"), JSON.stringify({ wrap }));
  assert.equal(run(["statusline"], payload).stdout.trim(), "[Opus] · 5h 12% 1h 0m · wk 34%");
});

test("statusline without rate limits prints nothing and does not fail", () => {
  writeFileSync(join(dir, "config", "cusage", "config.json"), "{}");
  const r = run(["statusline"], JSON.stringify({ model: {} }));
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("help, version, and unknown commands", () => {
  assert.match(run(["--help"]).stdout, /cusage watch/);
  assert.match(run(["-v"]).stdout, /^\d+\.\d+\.\d+/);
  const bad = run(["frobnicate"]);
  assert.equal(bad.status, 1);
  assert.match(bad.stderr, /unknown command "frobnicate"/);
});
