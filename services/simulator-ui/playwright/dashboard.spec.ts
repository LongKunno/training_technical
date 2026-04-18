import { expect, test } from "@playwright/test";

import { getEventSourceUrls, installEventSourceMock, mockJson } from "./support";

test("dashboard mounts current-session SSE and renders live monitor data", async ({ page }) => {
  await installEventSourceMock(page);

  await mockJson(page, "**/core/api/paper/session", {
    session: {
      id: "paper-current",
      last_event_at: "2026-04-18T09:05:00Z",
      reset_count: 0,
      started_at: "2026-04-18T09:00:00Z",
      status: "running",
    },
  });
  await mockJson(page, "**/core/api/paper/portfolio", {
    portfolio: {
      account_id: "paper-account-1",
      cash_balance: 9200,
      positions: [
        {
          average_price: 100,
          market_price: 105,
          market_value: 1050,
          quantity: 10,
          symbol: "BTCUSDT",
          unrealized_pnl: 50,
        },
      ],
      realized_pnl: 120,
      total_equity: 10250,
      unrealized_pnl: 50,
    },
  });
  await mockJson(page, "**/core/api/paper/positions", {
    positions: [
      {
        average_price: 100,
        market_price: 105,
        market_value: 1050,
        quantity: 10,
        symbol: "BTCUSDT",
        unrealized_pnl: 50,
      },
    ],
  });
  await mockJson(page, "**/core/api/paper/report", {
    report: {
      fees_paid: 4.5,
      filled_orders: 2,
      max_drawdown: 80,
      realized_pnl: 120,
      rejected_signals: 0,
      reset_count: 0,
      session_id: "paper-current",
      slippage_cost: 1.2,
      started_at: "2026-04-18T09:00:00Z",
      status: "running",
      symbols: [{ fees_paid: 4.5, filled_orders: 2, symbol: "BTCUSDT" }],
      timeline: [
        {
          cash_balance: 10000,
          drawdown: 0,
          equity: 10000,
          event_type: "session_started",
          timestamp: "2026-04-18T09:00:00Z",
          unrealized_pnl: 0,
        },
        {
          cash_balance: 9200,
          drawdown: 0,
          equity: 10250,
          event_type: "market_tick",
          timestamp: "2026-04-18T09:05:00Z",
          unrealized_pnl: 50,
        },
      ],
      total_pnl: 170,
      unrealized_pnl: 50,
    },
  });
  await mockJson(page, "**/core/api/paper/rules", {
    rules: {
      fee_rate: 0.001,
      initial_balance: 10000,
      paper_account_id: "paper-account-1",
      risk_controls: {
        allowed_symbols: ["BTCUSDT", "ETHUSDT"],
        cooldown_seconds: 30,
        max_daily_loss: 500,
        max_open_notional: 3000,
        max_order_notional: 1000,
        max_position_quantity: 20,
      },
      slippage_rate: 0.001,
    },
  });
  await mockJson(page, "**/core/api/paper/orders?*", {
    orders: [
      {
        account_id: "paper-account-1",
        executed_at: "2026-04-18T09:04:00Z",
        fee: 2.25,
        fee_rate: 0.001,
        id: "order-1",
        notional: 500,
        price: 100,
        quantity: 5,
        requested_price: 100,
        side: "buy",
        slippage_rate: 0.001,
        status: "filled",
        symbol: "BTCUSDT",
      },
    ],
  });
  await mockJson(page, "**/core/api/paper/timeline", {
    timeline: [
      {
        cash_balance: 10000,
        drawdown: 0,
        equity: 10000,
        event_type: "session_started",
        timestamp: "2026-04-18T09:00:00Z",
        unrealized_pnl: 0,
      },
      {
        cash_balance: 9200,
        drawdown: 0,
        equity: 10250,
        event_type: "market_tick",
        timestamp: "2026-04-18T09:05:00Z",
        unrealized_pnl: 50,
      },
    ],
  });

  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Current-session live monitor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What matters right now" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Where to look next" })).toBeVisible();
  await expect(page.getByText("paper-current", { exact: true })).toBeVisible();
  await expect(page.getByText("$10,250.00", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Open positions" })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Current positions" }).getByRole("cell", { name: "BTCUSDT" }),
  ).toBeVisible();
  await expect(page.getByText("Recent order flow available")).toBeVisible();

  await expect
    .poll(async () => getEventSourceUrls(page))
    .toEqual(["/core/api/paper/timeline/stream"]);
});
