import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, test } from "node:test";

const { install, uninstall, readConfig } = await import("../src/install.mjs");

let dir, settingsPath;
const bin = join(mkdtempSync(join(tmpdir(), "cusage-bin-")), "cusage.mjs");
writeFileSync(bin, "");
const settings = () => JSON.parse(readFileSync(settingsPath, "utf8"));

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "cusage-install-"));
  process.env.CLAUDE_CONFIG_DIR = join(dir, "claude");
  process.env.XDG_CONFIG_HOME = join(dir, "config");
  settingsPath = join(dir, "claude", "settings.json");
});

test("installs into empty settings", () => {
  install({ binPath: bin });
  assert.equal(settings().statusLine.type, "command");
  assert.match(settings().statusLine.command, /cusage\.mjs" statusline$/);
});

test("keeps other settings and backs up the file", () => {
  install({ binPath: bin }); // creates the file
  writeFileSync(settingsPath, JSON.stringify({ model: "opus", permissions: { allow: ["Bash(ls)"] } }));
  install({ binPath: bin });
  assert.equal(settings().model, "opus");
  assert.deepEqual(settings().permissions, { allow: ["Bash(ls)"] });
  assert.ok(existsSync(settingsPath + ".cusage.bak"));
});

test("wraps an existing status line and restores it on uninstall", () => {
  install({ binPath: bin });
  const theirs = { type: "command", command: "~/bin/my-status.sh", padding: 1, refreshInterval: 5 };
  writeFileSync(settingsPath, JSON.stringify({ statusLine: theirs }));
  const notes = install({ binPath: bin });
  assert.match(notes.join(" "), /Kept your existing status line/);
  assert.deepEqual(readConfig().wrap, theirs);
  assert.equal(settings().statusLine.padding, 1);
  assert.equal(settings().statusLine.refreshInterval, 5);

  uninstall();
  assert.deepEqual(settings().statusLine, theirs);
  assert.equal(readConfig().wrap, undefined);
});

test("installing twice does not wrap itself", () => {
  install({ binPath: bin });
  install({ binPath: bin });
  assert.equal(readConfig().wrap, undefined);
  uninstall();
  assert.equal(settings().statusLine, undefined);
});

test("uninstall leaves someone else's status line alone", () => {
  install({ binPath: bin });
  writeFileSync(settingsPath, JSON.stringify({ statusLine: { type: "command", command: "other" } }));
  assert.match(uninstall()[0], /nothing to do/);
  assert.equal(settings().statusLine.command, "other");
});

test("refuses to touch settings that are not valid JSON", () => {
  install({ binPath: bin });
  writeFileSync(settingsPath, "{ not json");
  assert.throws(() => install({ binPath: bin }), /not valid JSON/);
  assert.equal(readFileSync(settingsPath, "utf8"), "{ not json");
});
