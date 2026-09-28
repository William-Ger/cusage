# Changelog

## 1.0.0 (2026-09-27)

First public release.

- `cusage`, `cusage watch`, `cusage line`, `cusage json`: plan usage from the Claude usage API, with a pace tick on every bar.
- Responsive layout: one row per limit in wide panes, stacked cards in narrow ones, no wrapping down to 12 columns.
- `cusage install` / `cusage uninstall`: live numbers in Claude Code's status line, keeping any status line you already had.
- Shared disk cache and 429 backoff for the rate-limited usage API.
- Reads Claude Code credentials from the macOS Keychain or `~/.claude/.credentials.json`.
