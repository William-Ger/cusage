// Renders cusage output with sample data to SVGs for the README:
//   docs/wide.svg, docs/narrow.svg, docs/statusline.svg
// Run with `npm run demo`.

import { writeFileSync } from "node:fs";
import { render, statusSegment } from "../src/render.mjs";
import { usage } from "../test/fixture.mjs";

const COLORS = { 31: "#f38ba8", 32: "#a6e3a1", 33: "#f9e2af", 36: "#94e2d5", 90: "#585b70" };
const FG = "#cdd6f4";
const BG = "#1e1e2e";
const CW = 8.4; // cell width at 14px
const LH = 20;
const PAD = 16;
const TOP = 36; // room for the window dots

const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Split one ANSI line into styled runs placed on a fixed character grid.
function runs(line) {
  const out = [];
  let style = {};
  let col = 0;
  for (const part of line.split(/(\x1b\[[0-9;]*m)/)) {
    const m = part.match(/^\x1b\[([0-9;]*)m$/);
    if (m) {
      for (const code of m[1].split(";").map(Number)) {
        if (code === 0) style = {};
        else if (code === 1) style = { ...style, bold: true };
        else if (code === 2) style = { ...style, dim: true };
        else if (COLORS[code]) style = { ...style, color: COLORS[code] };
      }
    } else if (part) {
      out.push({ text: part, col, ...style });
      col += [...part].length;
    }
  }
  return out;
}

function svg(text, cols) {
  const lines = text.split("\n");
  const w = Math.round(cols * CW + PAD * 2);
  const h = TOP + lines.length * LH + PAD;
  // Bar glyphs are drawn as shapes so they have no seams between cells.
  const cell = (r, i) => {
    const x = PAD + r.col * CW;
    const y = TOP + i * LH + 2;
    const n = [...r.text].length;
    const ch = r.text[0];
    if (ch === "█") return `<rect x="${x.toFixed(1)}" y="${y}" width="${(n * CW).toFixed(1)}" height="15" rx="2" fill="${r.color ?? FG}"/>`;
    if (ch === "░") return `<rect x="${x.toFixed(1)}" y="${y}" width="${(n * CW).toFixed(1)}" height="15" rx="2" fill="${FG}" opacity="0.1"/>`;
    if (ch === "┃") return `<rect x="${(x + CW / 2 - 1.5).toFixed(1)}" y="${y - 3}" width="3" height="21" rx="1.5" fill="${FG}"/>`;
    return null;
  };
  const body = lines
    .map((line, i) =>
      runs(line)
        .filter((r) => r.text.trim())
        .map((r) => {
          const shape = /^[█░┃]+$/.test(r.text) && (r.text[0] === "┃" || new Set(r.text).size === 1) ? cell(r, i) : null;
          if (shape) return shape;
          const attrs = [
            `x="${(PAD + r.col * CW).toFixed(1)}"`,
            `y="${TOP + i * LH + 14}"`,
            `textLength="${([...r.text].length * CW).toFixed(1)}"`,
            `lengthAdjust="spacingAndGlyphs"`,
            `fill="${r.color ?? FG}"`,
            r.bold ? `font-weight="700"` : "",
            r.dim ? `opacity="0.6"` : "",
          ];
          return `<text ${attrs.filter(Boolean).join(" ")} xml:space="preserve">${esc(r.text)}</text>`;
        })
        .join(""),
    )
    .join("\n  ");
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" font-family="ui-monospace, SFMono-Regular, Menlo, Consolas, monospace" font-size="14">
  <rect width="${w}" height="${h}" rx="10" fill="${BG}"/>
  <circle cx="20" cy="18" r="6" fill="#f38ba8"/><circle cx="40" cy="18" r="6" fill="#f9e2af"/><circle cx="60" cy="18" r="6" fill="#a6e3a1"/>
  ${body}
</svg>
`;
}

const u = usage({ session: 63, weekly: 41, scoped: 12 }, 12_000);
const wide = render(u, { cols: 84, height: 30, watch: true });
const narrow = render(u, { cols: 44, height: 30, watch: true });

const reset = Math.floor(Date.now() / 1000);
const segment = statusSegment({
  five_hour: { used_percentage: 63, resets_at: reset + 3 * 3600 + 60 },
  seven_day: { used_percentage: 41, resets_at: reset + 4 * 86400 + 60 },
});
const status = `\x1b[1m>\x1b[0m \x1b[2mTry "refactor the parser"\x1b[0m\n\n ${segment}`;

writeFileSync(new URL("../docs/wide.svg", import.meta.url), svg(wide, 84));
writeFileSync(new URL("../docs/narrow.svg", import.meta.url), svg(narrow, 44));
writeFileSync(new URL("../docs/statusline.svg", import.meta.url), svg(status, 44));
console.log("wrote docs/wide.svg, docs/narrow.svg, docs/statusline.svg");
