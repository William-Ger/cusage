// Data layer: credentials, the usage API, the on-disk cache, and the live
// snapshot written by the Claude Code status line.

import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export const USAGE_URL = "https://api.anthropic.com/api/oauth/usage";
export const HOUR = 3600e3;
export const DAY = 24 * HOUR;

const VERSION = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")).version;

// Resolved on every call so tests and users can redirect them with env vars.
export const claudeDir = () => process.env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude");
export const cacheDir = () =>
  process.env.CUSAGE_CACHE_DIR ||
  join(process.env.XDG_CACHE_HOME || join(homedir(), ".cache"), "cusage");
const cacheFile = () => join(cacheDir(), "usage.json");
const liveFile = () => join(cacheDir(), "live.json");

export class UsageError extends Error {
  constructor(message, { status, retryAfter } = {}) {
    super(message);
    this.status = status;
    this.retryAfter = retryAfter;
  }
}

// ── credentials ───────────────────────────────────────────────────────────
// Claude Code keeps its OAuth login in the macOS Keychain, or in
// ~/.claude/.credentials.json on Linux and Windows.
export function readCreds() {
  let raw;
  if (process.platform === "darwin") {
    try {
      raw = execFileSync("security", ["find-generic-password", "-s", "Claude Code-credentials", "-w"], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      });
    } catch {}
  }
  if (!raw) {
    try {
      raw = readFileSync(join(claudeDir(), ".credentials.json"), "utf8");
    } catch {
      throw new UsageError("No Claude Code login found. Run `claude` and log in with your Pro or Max plan.");
    }
  }
  const o = JSON.parse(raw).claudeAiOauth;
  if (!o?.accessToken)
    throw new UsageError("Claude Code is not logged in with a Claude subscription. Run `claude` and use /login.");
  return o;
}

export function planName(creds) {
  const t = creds.subscriptionType;
  const tier = creds.rateLimitTier?.match(/(\d+)x/)?.[1];
  return t ? `Claude ${t[0].toUpperCase()}${t.slice(1)}${tier ? ` ${tier}x` : ""}` : "Claude";
}

// ── small JSON files ──────────────────────────────────────────────────────
function readJson(file) {
  try {
    return JSON.parse(readFileSync(file, "utf8"));
  } catch {
    return null;
  }
}

// Atomic write so a reader never sees half a file (several Claude Code
// sessions can write the live snapshot at once).
function writeJson(file, value) {
  try {
    mkdirSync(dirname(file), { recursive: true });
    const tmp = `${file}.${process.pid}.tmp`;
    writeFileSync(tmp, JSON.stringify(value), { mode: 0o600 });
    chmodSync(tmp, 0o600);
    renameSync(tmp, file);
  } catch {}
}

// ── the usage API ─────────────────────────────────────────────────────────
// Undocumented endpoint used by Claude Code's /usage. It allows a short burst
// and then roughly one request every two minutes, so every caller shares a
// disk cache and falls back to it when a request fails.
export async function fetchRemote(creds) {
  if (creds.expiresAt && creds.expiresAt < Date.now())
    throw new UsageError("Your Claude Code login token has expired. Open Claude Code once and it will refresh it.");
  const res = await fetch(USAGE_URL, {
    headers: {
      Authorization: `Bearer ${creds.accessToken}`,
      "anthropic-beta": "oauth-2025-04-20",
      "User-Agent": `cusage/${VERSION}`,
    },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 401)
    throw new UsageError("Token rejected (401). Open Claude Code once to refresh it.", { status: 401 });
  if (res.status === 429)
    throw new UsageError("Usage API rate limited (429).", {
      status: 429,
      retryAfter: Number(res.headers.get("retry-after")) || null,
    });
  if (!res.ok) throw new UsageError(`Usage API returned HTTP ${res.status}.`, { status: res.status });
  const data = await res.json();
  writeJson(cacheFile(), { fetchedAt: Date.now(), data });
  return data;
}

// Returns { data, creds, fetchedAt, warning?, error? }. Serves the cache when
// it is younger than maxAgeMs, or when the request fails and a cache exists.
export async function fetchUsage({ maxAgeMs = 45_000 } = {}) {
  const creds = readCreds();
  const c = readJson(cacheFile());
  const cached = c?.data ? { data: c.data, fetchedAt: new Date(c.fetchedAt) } : null;
  if (cached && Date.now() - cached.fetchedAt < maxAgeMs) return { ...cached, creds };
  try {
    return { data: await fetchRemote(creds), creds, fetchedAt: new Date() };
  } catch (e) {
    if (!cached) throw e;
    return { ...cached, creds, warning: `${e.message} Showing cached numbers.`, error: e };
  }
}

// ── live snapshot from the Claude Code status line ────────────────────────
// Claude Code passes `rate_limits` to the status-line command after every
// response. We keep the latest one so every view can show it immediately.
export function saveLive(rateLimits) {
  const win = (w) =>
    w && w.used_percentage != null ? { pct: w.used_percentage, resetsAt: w.resets_at ? w.resets_at * 1000 : null } : null;
  const live = { at: Date.now(), five_hour: win(rateLimits?.five_hour), seven_day: win(rateLimits?.seven_day) };
  if (!live.five_hour && !live.seven_day) return null;
  writeJson(liveFile(), live);
  return live;
}

export const readLive = () => readJson(liveFile());

// Patch the session and weekly numbers with the live snapshot when it is
// newer than the API result. Per-model limits still come from the API.
export function withLive(u, live = readLive()) {
  if (!live || !(live.at > u.fetchedAt)) return u;
  const data = structuredClone(u.data);
  const patch = (w, kind, legacy) => {
    if (!w || (w.resetsAt && w.resetsAt < Date.now())) return;
    const iso = w.resetsAt ? new Date(w.resetsAt).toISOString() : undefined;
    for (const l of data.limits ?? []) if (l.kind === kind) Object.assign(l, { percent: w.pct }, iso && { resets_at: iso });
    if (data[legacy]) Object.assign(data[legacy], { utilization: w.pct }, iso && { resets_at: iso });
  };
  patch(live.five_hour, "session", "five_hour");
  patch(live.seven_day, "weekly_all", "seven_day");
  // Fresh live numbers make a rate-limited API call irrelevant.
  const warning = u.error?.status === 429 ? undefined : u.warning;
  return { ...u, data, fetchedAt: new Date(live.at), warning };
}

// ── normalising the response ──────────────────────────────────────────────
// Rows of { label, pct, resetsAt, windowMs }. Prefers the `limits` array and
// falls back to the older five_hour / seven_day fields.
export function rows(data) {
  const out = [];
  if (Array.isArray(data?.limits) && data.limits.length) {
    for (const l of data.limits) {
      const scope = l.scope?.model?.display_name || l.scope?.surface?.display_name;
      const label =
        l.kind === "session" ? "Session" : l.kind === "weekly_all" ? "Weekly" : scope ? `${scope} wk` : l.kind;
      const windowMs = l.group === "session" ? 5 * HOUR : l.group === "weekly" ? 7 * DAY : null;
      out.push({ label, pct: l.percent ?? 0, resetsAt: l.resets_at, windowMs });
    }
  } else if (data) {
    const add = (label, v, windowMs) =>
      v && out.push({ label, pct: v.utilization ?? 0, resetsAt: v.resets_at, windowMs });
    add("Session", data.five_hour, 5 * HOUR);
    add("Weekly", data.seven_day, 7 * DAY);
    add("Opus wk", data.seven_day_opus, 7 * DAY);
    add("Sonnet wk", data.seven_day_sonnet, 7 * DAY);
  }
  return out;
}
