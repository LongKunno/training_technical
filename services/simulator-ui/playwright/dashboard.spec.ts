import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  getEventSourceUrls,
  installEventSourceMock,
  mockJson,
  mockJsonHandler,
  mockPlatformHealth,
} from "./support";

test("dashboard mounts current-session SSE and renders live monitor data", async ({ page }) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

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
        requested_quantity: 8,
        requested_price: 100,
        remaining_quantity: 3,
        side: "buy",
        slippage_rate: 0.001,
        fill_count: 2,
        status: "partially_filled",
        symbol: "BTCUSDT",
        terminal_reason: "cancel_after_ticks",
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
  await expect(page.getByRole("heading", { name: "Control room" })).toBeVisible();
  await expect(page.getByText("paper-current", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("heading", { name: "Bot Runner" })).toBeVisible();
  await expect(page.getByText("Bot Runner (Python) is healthy.")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText("$10,250.00", { exact: true })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Exposure by symbol" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Open positions" })).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Current positions" }).getByRole("cell", { name: "BTCUSDT" }),
  ).toBeVisible();
  const ordersTable = page.getByRole("table", { name: "Current orders" });
  await expect(ordersTable.getByText("of 8")).toBeVisible();
  await expect(ordersTable.getByText("partially filled")).toBeVisible();
  await expect(ordersTable.getByText("2 fills · 3 remaining")).toBeVisible();
  await expect(ordersTable.getByText("cancel after ticks")).toBeVisible();
  await expect(page.getByText("Recent order flow available")).toHaveCount(0);
  await page.getByRole("button", { name: "View alerts" }).click();
  await expect(page.getByText("Recent order flow available")).toBeVisible();
  await page.getByLabel("Open help").first().click();
  await expect(page.getByRole("tooltip")).toBeVisible();

  await expect
    .poll(async () => getEventSourceUrls(page))
    .toEqual(["/core/api/paper/timeline/stream"]);
});

test("dashboard keeps a stopped snapshot visible without mounting SSE", async ({ page }) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  await mockJson(page, "**/core/api/paper/session", {
    session: {
      id: "paper-stopped",
      last_event_at: "2026-04-18T09:05:00Z",
      reset_count: 1,
      started_at: "2026-04-18T09:00:00Z",
      status: "stopped",
    },
  });
  await mockJson(page, "**/core/api/paper/portfolio", {
    portfolio: {
      account_id: "paper-account-1",
      cash_balance: 9100,
      positions: [
        {
          average_price: 100,
          market_price: 103,
          market_value: 1030,
          quantity: 10,
          symbol: "BTCUSDT",
          unrealized_pnl: 30,
        },
      ],
      realized_pnl: 110,
      total_equity: 10140,
      unrealized_pnl: 30,
    },
  });
  await mockJson(page, "**/core/api/paper/positions", {
    positions: [
      {
        average_price: 100,
        market_price: 103,
        market_value: 1030,
        quantity: 10,
        symbol: "BTCUSDT",
        unrealized_pnl: 30,
      },
    ],
  });
  await mockJson(page, "**/core/api/paper/report", {
    report: {
      fees_paid: 4.1,
      filled_orders: 2,
      max_drawdown: 95,
      realized_pnl: 110,
      rejected_signals: 0,
      reset_count: 1,
      session_id: "paper-stopped",
      slippage_cost: 1.1,
      started_at: "2026-04-18T09:00:00Z",
      status: "stopped",
      symbols: [{ fees_paid: 4.1, filled_orders: 2, symbol: "BTCUSDT" }],
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
          cash_balance: 9100,
          drawdown: 20,
          equity: 10140,
          event_type: "session_stopped",
          timestamp: "2026-04-18T09:05:00Z",
          unrealized_pnl: 30,
        },
      ],
      total_pnl: 140,
      unrealized_pnl: 30,
    },
  });
  await mockJson(page, "**/core/api/paper/rules", {
    rules: {
      fee_rate: 0.001,
      initial_balance: 10000,
      paper_account_id: "paper-account-1",
      risk_controls: {
        allowed_symbols: ["BTCUSDT"],
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
        fee: 2.05,
        fee_rate: 0.001,
        id: "order-stopped-1",
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
        cash_balance: 9100,
        drawdown: 20,
        equity: 10140,
        event_type: "session_stopped",
        timestamp: "2026-04-18T09:05:00Z",
        unrealized_pnl: 30,
      },
    ],
  });

  await page.goto("/dashboard");

  await expect(page.getByText("Stopped snapshot").first()).toBeVisible();
  await expect(page.getByText("paper-stopped", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("frozen snapshot")).toBeVisible();
  await page.getByRole("button", { name: "View alerts" }).click();
  await expect(page.getByText("SSE intentionally idle")).toBeVisible();
  await expect
    .poll(async () => getEventSourceUrls(page))
    .toEqual([]);
});

test("dashboard falls back to the latest historical session when no live session exists", async ({
  page,
}) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  const sessionNotFoundPayload = {
    error: {
      code: "session_not_found",
      message: "No current session.",
    },
  };

  await mockJsonHandler(page, "**/core/api/paper/session", async (route) => {
    await fulfillJson(route, sessionNotFoundPayload, 404);
  });
  await mockJsonHandler(page, "**/core/api/paper/portfolio", async (route) => {
    await fulfillJson(route, sessionNotFoundPayload, 404);
  });
  await mockJsonHandler(page, "**/core/api/paper/positions", async (route) => {
    await fulfillJson(route, sessionNotFoundPayload, 404);
  });
  await mockJsonHandler(page, "**/core/api/paper/report", async (route) => {
    await fulfillJson(route, sessionNotFoundPayload, 404);
  });
  await mockJsonHandler(page, "**/core/api/paper/rules", async (route) => {
    await fulfillJson(route, sessionNotFoundPayload, 404);
  });
  await mockJsonHandler(page, "**/core/api/paper/orders?*", async (route) => {
    await fulfillJson(route, sessionNotFoundPayload, 404);
  });
  await mockJsonHandler(page, "**/core/api/paper/timeline", async (route) => {
    await fulfillJson(route, sessionNotFoundPayload, 404);
  });
  await mockJson(page, "**/core/api/paper/sessions?*", {
    sessions: [
      {
        filled_orders: 4,
        last_event_at: "2026-04-18T09:05:00Z",
        max_drawdown: 90,
        realized_pnl: 120,
        rejected_signals: 0,
        reset_count: 1,
        session_id: "paper-history-latest",
        started_at: "2026-04-18T09:00:00Z",
        status: "stopped",
        total_pnl: 145,
      },
    ],
  });

  await page.goto("/dashboard");

  await expect(page.getByText("No live session").first()).toBeVisible();
  await expect(page.getByText("Dashboard is idle").first()).toBeVisible();
  await expect(page.getByRole("heading", { name: "Most recent stored session" })).toBeVisible();
  await expect(page.getByText("paper-history-latest", { exact: true }).first()).toBeVisible();
  await page.getByRole("button", { name: "View alerts" }).click();
  await expect(page.getByText("Latest stored session ready")).toBeVisible();
  await expect
    .poll(async () => getEventSourceUrls(page))
    .toEqual([]);
});

test("dashboard surfaces core-down degraded copy when the current snapshot cannot load", async ({
  page,
}) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page, { core: "down" });

  await mockJsonHandler(page, "**/core/api/paper/**", async (route) => {
    await fulfillJson(
      route,
      {
        error: {
          code: "upstream_unavailable",
          message: "Core Trading (Go) is unavailable.",
        },
      },
      503,
    );
  });

  await page.goto("/dashboard");

  await expect(page.getByRole("heading", { name: "Current-session live monitor" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Core trading API unavailable" }).first()).toBeVisible();
  await expect(page.getByText("Dashboard chưa đọc được snapshot paper hiện tại", { exact: false }).first()).toBeVisible();
  await expect
    .poll(async () => getEventSourceUrls(page))
    .toEqual([]);
});
