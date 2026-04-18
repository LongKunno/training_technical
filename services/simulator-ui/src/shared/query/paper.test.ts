import { describe, expect, it } from "vitest";
import { QueryClient } from "@tanstack/react-query";

import type { CurrentSessionSnapshot, SessionReport, SessionTimelinePoint } from "../types";
import { paperQueryKeys } from "./keys";
import { applyCurrentTimelinePoint } from "./paper";

const initialCurrentPoint: SessionTimelinePoint = {
  cash_balance: 10000,
  drawdown: 0,
  equity: 10000,
  event_type: "session_started",
  timestamp: "2026-04-18T09:00:00Z",
  unrealized_pnl: 0,
};

const nextCurrentPoint: SessionTimelinePoint = {
  cash_balance: 9200,
  drawdown: 0,
  equity: 10250,
  event_type: "market_tick",
  timestamp: "2026-04-18T09:05:00Z",
  unrealized_pnl: 50,
};

const historicalPoint: SessionTimelinePoint = {
  cash_balance: 10000,
  drawdown: 10,
  equity: 9990,
  event_type: "session_stopped",
  timestamp: "2026-04-17T10:00:00Z",
  unrealized_pnl: 0,
};

function buildReport(sessionId: string, timeline: SessionTimelinePoint[]): SessionReport {
  return {
    fees_paid: 1,
    filled_orders: 1,
    max_drawdown: 10,
    realized_pnl: 0,
    rejected_signals: 0,
    reset_count: 0,
    session_id: sessionId,
    slippage_cost: 0,
    started_at: timeline[0]?.timestamp ?? "2026-04-18T09:00:00Z",
    status: sessionId === "paper-historical" ? "stopped" : "running",
    symbols: [],
    timeline,
    total_pnl: 0,
    unrealized_pnl: timeline[timeline.length - 1]?.unrealized_pnl ?? 0,
  };
}

function buildSnapshot(timeline: SessionTimelinePoint[]): CurrentSessionSnapshot {
  return {
    orders: [],
    portfolio: {
      account_id: "paper-account-1",
      cash_balance: 9200,
      positions: [],
      realized_pnl: 0,
      total_equity: 10250,
      unrealized_pnl: 50,
    },
    positions: [],
    report: buildReport("paper-current", timeline),
    rules: {
      fee_rate: 0.001,
      initial_balance: 10000,
      paper_account_id: "paper-account-1",
      risk_controls: {
        allowed_symbols: [],
        cooldown_seconds: 0,
        max_daily_loss: 0,
        max_open_notional: 0,
        max_order_notional: 0,
        max_position_quantity: 0,
      },
      slippage_rate: 0.001,
    },
    session: {
      id: "paper-current",
      last_event_at: nextCurrentPoint.timestamp,
      reset_count: 0,
      started_at: initialCurrentPoint.timestamp,
      status: "running",
    },
    timeline,
  };
}

describe("applyCurrentTimelinePoint", () => {
  it("updates only current-session caches and leaves historical caches intact", () => {
    const queryClient = new QueryClient();
    const historicalTimeline = [historicalPoint];
    const historicalReport = buildReport("paper-historical", historicalTimeline);

    queryClient.setQueryData(paperQueryKeys.timeline(), [initialCurrentPoint]);
    queryClient.setQueryData(paperQueryKeys.report(), buildReport("paper-current", [initialCurrentPoint]));
    queryClient.setQueryData(
      paperQueryKeys.currentSnapshot(),
      buildSnapshot([initialCurrentPoint]),
    );
    queryClient.setQueryData(
      paperQueryKeys.timeline({ session_id: "paper-historical" }),
      historicalTimeline,
    );
    queryClient.setQueryData(
      paperQueryKeys.report({ session_id: "paper-historical" }),
      historicalReport,
    );

    applyCurrentTimelinePoint(queryClient, nextCurrentPoint);

    expect(queryClient.getQueryData(paperQueryKeys.timeline())).toEqual([
      initialCurrentPoint,
      nextCurrentPoint,
    ]);
    expect(
      (queryClient.getQueryData(paperQueryKeys.report()) as SessionReport).timeline,
    ).toEqual([initialCurrentPoint, nextCurrentPoint]);
    expect(
      (queryClient.getQueryData(paperQueryKeys.currentSnapshot()) as CurrentSessionSnapshot).timeline,
    ).toEqual([initialCurrentPoint, nextCurrentPoint]);

    expect(
      queryClient.getQueryData(paperQueryKeys.timeline({ session_id: "paper-historical" })),
    ).toEqual(historicalTimeline);
    expect(
      queryClient.getQueryData(paperQueryKeys.report({ session_id: "paper-historical" })),
    ).toEqual(historicalReport);
  });
});
