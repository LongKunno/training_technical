import { describe, expect, it } from "vitest";

import type { CurrentSessionSnapshot, SessionReport } from "../types";
import { normalizeCurrentSessionSnapshot, normalizeSessionReport } from "./core";

describe("core API normalization", () => {
  it("normalizes nullable report arrays", () => {
    const report = normalizeSessionReport({
      fees_paid: 0,
      filled_orders: 0,
      max_drawdown: 0,
      realized_pnl: 0,
      rejected_signals: 0,
      reset_count: 0,
      session_id: "paper-current",
      slippage_cost: 0,
      started_at: "2026-04-21T14:00:00Z",
      status: "running",
      symbols: null,
      timeline: null,
      total_pnl: 0,
      unrealized_pnl: 0,
    } as unknown as SessionReport);

    expect(report.symbols).toEqual([]);
    expect(report.timeline).toEqual([]);
  });

  it("normalizes current snapshot arrays and allowed symbols", () => {
    const snapshot = normalizeCurrentSessionSnapshot({
      orders: null,
      portfolio: {
        account_id: "paper-account-1",
        cash_balance: 10000,
        positions: null,
        realized_pnl: 0,
        total_equity: 10000,
        unrealized_pnl: 0,
      },
      positions: null,
      report: {
        fees_paid: 0,
        filled_orders: 0,
        max_drawdown: 0,
        realized_pnl: 0,
        rejected_signals: 0,
        reset_count: 0,
        session_id: "paper-current",
        slippage_cost: 0,
        started_at: "2026-04-21T14:00:00Z",
        status: "running",
        symbols: null,
        timeline: null,
        total_pnl: 0,
        unrealized_pnl: 0,
      },
      rules: {
        fee_rate: 0.001,
        initial_balance: 10000,
        paper_account_id: "paper-account-1",
        risk_controls: {
          allowed_symbols: null,
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
        last_event_at: "2026-04-21T14:00:00Z",
        reset_count: 0,
        started_at: "2026-04-21T14:00:00Z",
        status: "running",
      },
      timeline: null,
    } as unknown as CurrentSessionSnapshot);

    expect(snapshot.orders).toEqual([]);
    expect(snapshot.portfolio.positions).toEqual([]);
    expect(snapshot.positions).toEqual([]);
    expect(snapshot.report.symbols).toEqual([]);
    expect(snapshot.report.timeline).toEqual([]);
    expect(snapshot.rules.risk_controls.allowed_symbols).toEqual([]);
    expect(snapshot.timeline).toEqual([]);
  });
});
