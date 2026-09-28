#!/usr/bin/env node
// cusage: your Claude plan usage in the terminal.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { install, readConfig, uninstall } from "../src/install.mjs";
import { render, renderLine, statusSegment, theme } from "../src/render.mjs";
import { fetchUsage, saveLive, withLive } from "../src/usage.mjs";

const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));

const HELP = `cusage ${pkg.version}: your Claude plan usage in the terminal

Usage
  cusage                 show usage once
  cusage watch [secs]    live view; polls the API every [secs] (default 120, min 60)
  cusage line            one-line summary for prompts and status bars
  cusage json            raw usage API response
  cusage install         show live numbers in Claude Code's status line
  cusage uninstall       undo \`cusage install\`
  cusage statusline      the status-line command itself (reads JSON on stdin)

Options
  --no-color             plain output (also honours NO_COLOR)
  -h, --help             show this help
  -v, --version          show the version

Keys in watch: r refresh, q quit.`;

// ── arguments ─────────────────────────────────────────────────────────────
const ALIASES = {
  "-w": "watch", "--watch": "watch", "-l": "line", "--line": "line", "--json": "json",
  "--statusline": "statusline", "-h": "help", "--help": "help", "-v": "version", "--version": "version",
};
const argv = process.argv.slice(2);
const words = argv.map((a) => ALIASES[a] ?? a);
const cmd = words.find((a) => /^[a-z]+$/.test(a)) ?? "show";
const secs = Number(argv.find((a) => /^\d+$/.test(a)));
const interval = Math.max(60, secs || 120);
const color =
  !argv.includes("--no-color") && !process.env.NO_COLOR && (process.stdout.isTTY || cmd === "watch" || cmd === "statusline");
const t = theme(color);

const fail = (msg) => {
  console.error(t.red(`cusage: ${msg}`));
  process.exit(1);
};

// ── commands ──────────────────────────────────────────────────────────────
async function show(kind) {
  try {
    const u = withLive(await fetchUsage({ maxAgeMs: kind === "line" ? 60_000 : 45_000 }));
    if (kind === "json") console.log(JSON.stringify(u.data, null, 2));
    else if (kind === "line") console.log(renderLine(u, { color }));
    else console.log("\n" + render(u, { cols: process.stdout.columns, height: process.stdout.rows, color }) + "\n");
  } catch (e) {
    fail(e.message);
  }
}

async function watch() {
  const out = process.stdout;
  if (!out.isTTY) fail("watch needs a terminal.");
  let last = null;
  let err = null;
  let timer = null;
  let backoff = interval;

  const draw = () => {
    const opts = { cols: out.columns, height: out.rows, color, watch: true, staleAfterMs: Math.max(interval * 2, 240) * 1000 };
    const body = last ? "\n" + render(withLive(last), opts) : err ? t.red(` ${err}`) : t.dim(" loading…");
    // Overwrite in place (clear each line's tail, then below) to avoid flicker.
    out.write("\x1b[H" + body.split("\n").join("\x1b[K\n") + "\x1b[K\x1b[J");
  };

  const refresh = async (maxAgeMs = interval * 1000 - 5_000) => {
    clearTimeout(timer);
    try {
      last = await fetchUsage({ maxAgeMs });
      err = null;
      // Back off after a 429 instead of hammering the endpoint.
      backoff = last.error?.status === 429 ? Math.min(600, last.error.retryAfter || backoff * 2) : interval;
    } catch (e) {
      err = e.message;
      backoff = Math.min(600, e.retryAfter || backoff * 2);
    }
    draw();
    timer = setTimeout(refresh, backoff * 1000);
  };

  const quit = () => {
    out.write("\x1b[?7h\x1b[?25h\x1b[?1049l");
    process.exit(0);
  };

  out.write("\x1b[?1049h\x1b[?25l\x1b[?7l"); // alt screen, hide cursor, no line wrap
  process.on("SIGINT", quit);
  process.on("SIGTERM", quit);
  out.on("resize", draw);
  if (process.stdin.isTTY) {
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on("data", (k) => {
      const s = k.toString();
      if (s === "q" || s === "\x03" || s === "\x1b") quit();
      if (s === "r") refresh(10_000);
    });
  }

  await refresh();
  setInterval(draw, 1000); // tick "updated Xs ago" and the countdowns
}

// Claude Code runs this after every response with session JSON on stdin.
// Save the rate limits for the other views, run the user's previous status
// line if there was one, and print our segment after it.
function statusline() {
  let input = "";
  process.stdin.setEncoding("utf8");
  process.stdin.on("data", (d) => (input += d));
  process.stdin.on("end", () => {
    let rl;
    try {
      rl = JSON.parse(input).rate_limits;
    } catch {}
    if (rl) saveLive(rl);

    let theirs = "";
    const wrap = readConfig().wrap;
    if (wrap?.command) {
      const r = spawnSync(wrap.command, { shell: true, input, encoding: "utf8", timeout: 5_000 });
      theirs = (r.stdout || "").replace(/\n+$/, "");
    }
    const ours = statusSegment(rl, { color });
    if (theirs && ours) console.log(`${theirs}${t.dim(" · ")}${ours}`);
    else if (theirs || ours) console.log(theirs || ours);
  });
}

function runInstall(fn) {
  try {
    for (const line of fn()) console.log(line);
    if (fn === install) console.log("Numbers update after each Claude response. Run `cusage watch` in a side pane to see them.");
  } catch (e) {
    fail(e.message);
  }
}

switch (cmd) {
  case "show":
  case "line":
  case "json":
    show(cmd);
    break;
  case "watch":
    watch();
    break;
  case "statusline":
    statusline();
    break;
  case "install":
    runInstall(install);
    break;
  case "uninstall":
    runInstall(uninstall);
    break;
  case "help":
    console.log(HELP);
    break;
  case "version":
    console.log(pkg.version);
    break;
  default:
    console.error(`cusage: unknown command "${cmd}"\n\n${HELP}`);
    process.exit(1);
}
