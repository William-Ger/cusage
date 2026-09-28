// Rendering. Everything takes the terminal size and a color theme as inputs,
// so the layout can be tested at any width.

import { DAY, HOUR, planName, rows } from "./usage.mjs";

export function theme(color = true) {
  const c = (code) => (s) => (color ? `\x1b[${code}m${s}\x1b[0m` : String(s));
  const t = { dim: c("2"), bold: c("1"), green: c("32"), yellow: c("33"), red: c("31"), cyan: c("36"), gray: c("90") };
  t.tone = (pct) => (pct >= 90 ? t.red : pct >= 70 ? t.yellow : t.green);
  return t;
}

// ── text helpers ──────────────────────────────────────────────────────────
export const stripAnsi = (s) => s.replace(/\x1b\[[0-9;]*m/g, "");
export const clip = (s, w) => (s.length <= w ? s : w <= 1 ? s.slice(0, Math.max(0, w)) : s.slice(0, w - 1) + "…");

// Left and right text on one line of width w. The right side is dropped
// first when there is not enough room.
function spread(left, right, w, styleL = (x) => x, styleR = (x) => x) {
  if (!right || left.length + 1 + right.length > w) return styleL(clip(left, w));
  return styleL(left) + " ".repeat(w - left.length - right.length) + styleR(right);
}

// The first option that fits in w, else the last one clipped.
const pick = (w, ...opts) => opts.find((o) => o.length <= w) ?? clip(opts.at(-1), w);

// ── time ──────────────────────────────────────────────────────────────────
// Accepts an ISO string or epoch milliseconds.
export function until(t) {
  if (!t) return "";
  let ms = new Date(t) - Date.now();
  if (ms <= 0) return "now";
  const d = Math.floor(ms / DAY);
  ms -= d * DAY;
  const h = Math.floor(ms / HOUR);
  ms -= h * HOUR;
  const m = Math.floor(ms / 60e3);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
}

export function when(t) {
  if (!t) return "";
  const d = new Date(t);
  const time = d.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
  return d - Date.now() < DAY ? time : `${d.toLocaleDateString([], { weekday: "short" })} ${time}`;
}

export function ago(t) {
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 5) return "just now";
  if (s < 60) return `${s}s ago`;
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  return `${Math.floor(s / 3600)}h ago`;
}

// ── bar ───────────────────────────────────────────────────────────────────
// A usage bar with a ┃ tick at how far through the window we are, so you can
// see at a glance whether you are using the limit faster than the clock.
export function bar(pct, resetsAt, windowMs, width, t) {
  const filled = Math.round((Math.min(Math.max(pct, 0), 100) / 100) * width);
  let pace = -1;
  if (resetsAt && windowMs) {
    const elapsed = 1 - (new Date(resetsAt) - Date.now()) / windowMs;
    if (elapsed > 0 && elapsed < 1) pace = Math.min(width - 1, Math.floor(elapsed * width));
  }
  const col = t.tone(pct);
  const seg = (from, to) =>
    (from < Math.min(to, filled) ? col("█".repeat(Math.min(to, filled) - from)) : "") +
    (Math.max(from, filled) < to ? t.gray("░".repeat(to - Math.max(from, filled))) : "");
  if (pace < 0) return seg(0, width);
  return seg(0, pace) + t.bold(pace < filled ? col("┃") : "┃") + seg(pace + 1, width);
}

// ── full view ─────────────────────────────────────────────────────────────
// opts: { cols, height, color, watch, staleAfterMs }
export function render(u, opts = {}) {
  const { data, creds, fetchedAt, warning } = u;
  const t = theme(opts.color ?? true);
  const cols = Math.max(12, opts.cols || 80);
  const height = opts.height || 40;
  const W = cols - 2; // one-space gutter each side
  const r = rows(data);
  const labelW = Math.max(...r.map((x) => x.label.length), 7);
  const pctText = (x) => `${Math.round(x.pct)}%`;
  const lines = [];

  // Header: plan name, and how old the numbers are (yellow once stale).
  const stale = Date.now() - fetchedAt > (opts.staleAfterMs ?? 240_000);
  const plan = planName(creds);
  const age = ago(fetchedAt);
  const right = [`updated ${age}`, age].find((s) => plan.length + 1 + s.length <= W);
  lines.push(" " + spread(plan, right, W, t.bold, stale ? t.yellow : t.dim), "");

  const wideBar = Math.min(40, cols - labelW - 36);
  if (wideBar >= 24) {
    // Wide: one row per limit.
    for (const x of r) {
      const reset = x.resetsAt ? t.dim(`in ${until(x.resetsAt)}`.padEnd(10) + "  " + when(x.resetsAt)) : "";
      const pct = t.tone(x.pct)(pctText(x).padStart(4));
      lines.push(` ${x.label.padEnd(labelW)}  ${bar(x.pct, x.resetsAt, x.windowMs, wideBar, t)} ${pct}   ${reset}`);
    }
  } else {
    // Narrow: a stacked card per limit with a full-width bar. Blank lines
    // between cards only when the pane is tall enough.
    const gap = height >= 2 + r.length * 4 + 3;
    r.forEach((x, i) => {
      if (i && gap) lines.push("");
      lines.push(" " + spread(x.label, pctText(x), W, t.bold, t.tone(x.pct)));
      lines.push(" " + bar(x.pct, x.resetsAt, x.windowMs, W, t));
      if (x.resetsAt) {
        const at = when(x.resetsAt);
        const long = `resets in ${until(x.resetsAt)}`;
        const short = `in ${until(x.resetsAt)}`;
        const left = long.length + 1 + at.length <= W ? long : short.length + 1 + at.length <= W ? short : long;
        lines.push(" " + spread(left, at, W, t.dim, t.dim));
      }
    });
  }

  const ex = data.extra_usage;
  if (ex?.is_enabled && ex.used_credits != null) {
    const div = 10 ** (ex.decimal_places ?? 2);
    const used = (ex.used_credits / div).toFixed(2);
    const lim = ex.monthly_limit != null ? ` / ${(ex.monthly_limit / div).toFixed(2)}` : "";
    lines.push("", " " + spread("Extra this month", `${ex.currency ?? "USD"} ${used}${lim}`, W, t.dim, t.cyan));
  }

  const bd = data.seven_day_breakdown?.rows?.filter((b) => b.percent > 0);
  if (bd?.length > 1)
    lines.push("", " " + t.dim(clip(`this week: ${bd.map((b) => `${b.display_name} ${b.percent}%`).join(" · ")}`, W)));

  const keys = opts.watch ? ["   ·   r refresh   ·   q quit", "  ·  r  ·  q", ""] : [""];
  const legend = [...keys.map((k) => `┃ = time elapsed in window${k}`), ...keys.map((k) => `┃ = elapsed${k}`)];
  lines.push("", " " + t.dim(pick(W, ...legend)));
  if (warning) lines.push(" " + t.yellow(clip(`! ${warning}`, W)));
  return lines.join("\n");
}

// ── one-liners ────────────────────────────────────────────────────────────
export function renderLine(u, { color = true } = {}) {
  const t = theme(color);
  return rows(u.data)
    .slice(0, 2)
    .map((x) => `${x.label[0]} ${t.tone(x.pct)(Math.round(x.pct) + "%")}${x.resetsAt ? t.dim(` ${until(x.resetsAt)}`) : ""}`)
    .join(t.dim(" │ "));
}

// The segment shown inside Claude Code, from the status-line `rate_limits`.
export function statusSegment(rl, { color = true } = {}) {
  const t = theme(color);
  const part = (name, w) =>
    w?.used_percentage != null &&
    `${name} ${t.tone(w.used_percentage)(Math.round(w.used_percentage) + "%")}` +
      (w.resets_at ? t.dim(` ${until(w.resets_at * 1000)}`) : "");
  return [part("5h", rl?.five_hour), part("wk", rl?.seven_day)].filter(Boolean).join(t.dim(" · "));
}
