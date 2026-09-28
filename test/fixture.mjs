// A usage response shaped like the real API, with times relative to now.
const HOUR = 3600e3;
// 30s of slack so formatted countdowns are stable ("3h 0m", "4d 0h").
const iso = (ms) => new Date(Date.now() + ms + 30_000).toISOString();

export function sample({ session = 42, weekly = 18, scoped = 7 } = {}) {
  const sessionReset = iso(3 * HOUR);
  const weeklyReset = iso(4 * 24 * HOUR);
  return {
    five_hour: { utilization: session, resets_at: sessionReset },
    seven_day: { utilization: weekly, resets_at: weeklyReset },
    extra_usage: { is_enabled: false },
    limits: [
      { kind: "session", group: "session", percent: session, resets_at: sessionReset, scope: null },
      { kind: "weekly_all", group: "weekly", percent: weekly, resets_at: weeklyReset, scope: null },
      {
        kind: "weekly_scoped",
        group: "weekly",
        percent: scoped,
        resets_at: weeklyReset,
        scope: { model: { id: null, display_name: "Opus" }, surface: null },
      },
    ],
    seven_day_breakdown: {
      rows: [
        { key: "claude_code", display_name: "Claude Code", percent: 80 },
        { key: "chat", display_name: "Chats", percent: 20 },
      ],
    },
  };
}

export const creds = { accessToken: "test", subscriptionType: "max", rateLimitTier: "default_claude_max_5x" };

export const usage = (opts, fetchedAgoMs = 0) => ({ data: sample(opts), creds, fetchedAt: new Date(Date.now() - fetchedAgoMs) });
