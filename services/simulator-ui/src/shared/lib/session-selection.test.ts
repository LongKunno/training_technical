import { describe, expect, it } from "vitest";

import type { SessionHistoryEntry } from "../types";
import { resolveSelectedSessionId } from "./session-selection";
import { appendTimelinePoint, getReportTimeline } from "./timeline";

const sessions: SessionHistoryEntry[] = [
  {
    filled_orders: 2,
    last_event_at: "2026-04-18T09:05:00Z",
    max_drawdown: 42,
    realized_pnl: 12,
    rejected_signals: 0,
    reset_count: 0,
    session_id: "paper-current",
    started_at: "2026-04-18T09:00:00Z",
    status: "running",
    total_pnl: 12,
  },
  {
    filled_orders: 1,
    last_event_at: "2026-04-17T09:05:00Z",
    max_drawdown: 18,
    realized_pnl: -4,
    rejected_signals: 1,
    reset_count: 1,
    session_id: "paper-history",
    started_at: "2026-04-17T09:00:00Z",
    status: "stopped",
    total_pnl: -4,
  },
];

describe("resolveSelectedSessionId", () => {
  it("keeps the selected session when it is still visible", () => {
    expect(
      resolveSelectedSessionId({
        currentSessionId: "paper-current",
        selectedSessionId: "paper-history",
        sessions,
      }),
    ).toBe("paper-history");
  });

  it("falls back to the current session before the newest session", () => {
    expect(
      resolveSelectedSessionId({
        currentSessionId: "paper-current",
        selectedSessionId: "missing",
        sessions,
      }),
    ).toBe("paper-current");
  });
});

describe("timeline helpers", () => {
  it("deduplicates points and keeps chronological order", () => {
    const first = {
      cash_balance: 100,
      drawdown: 0,
      equity: 100,
      event_type: "session_started",
      timestamp: "2026-04-18T09:00:00Z",
      unrealized_pnl: 0,
    } as const;
    const second = {
      cash_balance: 95,
      drawdown: 5,
      equity: 95,
      event_type: "market_tick",
      timestamp: "2026-04-18T09:01:00Z",
      unrealized_pnl: -5,
    } as const;

    const appended = appendTimelinePoint([second], first);
    const deduplicated = appendTimelinePoint(appended, second);

    expect(deduplicated).toEqual([first, second]);
  });

  it("returns a normalized report timeline", () => {
    const timeline = getReportTimeline({
      timeline: [
        {
          cash_balance: 95,
          drawdown: 5,
          equity: 95,
          event_type: "market_tick",
          timestamp: "2026-04-18T09:01:00Z",
          unrealized_pnl: -5,
        },
        {
          cash_balance: 100,
          drawdown: 0,
          equity: 100,
          event_type: "session_started",
          timestamp: "2026-04-18T09:00:00Z",
          unrealized_pnl: 0,
        },
      ],
    });

    expect(timeline.map((point) => point.event_type)).toEqual([
      "session_started",
      "market_tick",
    ]);
  });
});
