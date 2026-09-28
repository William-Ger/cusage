// `cusage install` / `cusage uninstall`: set cusage as Claude Code's status
// line. An existing status line is kept: cusage runs it and appends its own
// segment, and uninstall puts it back exactly as it was.

import { copyFileSync, existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";
import { claudeDir } from "./usage.mjs";

export const settingsFile = () => join(claudeDir(), "settings.json");
export const configFile = () =>
  join(process.env.XDG_CONFIG_HOME || join(homedir(), ".config"), "cusage", "config.json");

const isOurs = (sl) => typeof sl?.command === "string" && /cusage/.test(sl.command);

function readSettings() {
  const file = settingsFile();
  if (!existsSync(file)) return {};
  const raw = readFileSync(file, "utf8");
  try {
    return JSON.parse(raw);
  } catch {
    throw new Error(`${file} is not valid JSON, so cusage left it alone. Fix it and try again.`);
  }
}

function writeSettings(settings) {
  const file = settingsFile();
  mkdirSync(dirname(file), { recursive: true });
  if (existsSync(file)) copyFileSync(file, `${file}.cusage.bak`);
  writeFileSync(file, JSON.stringify(settings, null, 2) + "\n");
}

export function readConfig() {
  try {
    return JSON.parse(readFileSync(configFile(), "utf8"));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  mkdirSync(dirname(configFile()), { recursive: true });
  writeFileSync(configFile(), JSON.stringify(config, null, 2) + "\n");
}

// The command Claude Code should run. Uses the real path of this install so
// it does not depend on the PATH Claude Code's shell happens to have.
export function statusCommand(binPath = process.argv[1]) {
  const real = realpathSync(binPath);
  if (/[\\/]_npx[\\/]/.test(real))
    throw new Error("Install cusage globally first (npm install -g cusage); npx copies are temporary.");
  return process.platform === "win32" ? `node "${real}" statusline` : `"${real}" statusline`;
}

export function install({ binPath } = {}) {
  const settings = readSettings();
  const existing = settings.statusLine;
  const config = readConfig();
  const notes = [];

  if (existing && !isOurs(existing)) {
    config.wrap = existing;
    writeConfig(config);
    notes.push(`Kept your existing status line; cusage runs it and adds its numbers after it.`);
  }

  const { type, command, ...rest } = existing && isOurs(existing) ? existing : {};
  const keep = existing && !isOurs(existing) ? pickKeep(existing) : rest;
  settings.statusLine = { type: "command", command: statusCommand(binPath), ...keep };
  writeSettings(settings);
  notes.unshift(`Status line set in ${settingsFile()}.`);
  return notes;
}

// Settings from a replaced status line that still make sense for ours.
function pickKeep(sl) {
  const out = {};
  if (sl.padding != null) out.padding = sl.padding;
  if (sl.refreshInterval != null) out.refreshInterval = sl.refreshInterval;
  return out;
}

export function uninstall() {
  const settings = readSettings();
  if (!isOurs(settings.statusLine)) return ["cusage is not your Claude Code status line; nothing to do."];
  const config = readConfig();
  if (config.wrap) {
    settings.statusLine = config.wrap;
    delete config.wrap;
    writeConfig(config);
    writeSettings(settings);
    return ["Restored your previous status line."];
  }
  delete settings.statusLine;
  writeSettings(settings);
  return ["Removed cusage from your Claude Code status line."];
}
