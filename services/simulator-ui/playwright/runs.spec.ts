import { expect, test } from "@playwright/test";

import { fulfillJson, installEventSourceMock, mockJson, mockJsonHandler, mockPlatformHealth } from "./support";

const botCatalog = [
  {
    bot_id: "baseline-roundtrip",
    current_version: "v1",
    default_scenario: "baseline",
    description: "Reference benchmark bot.",
    name: "Baseline Roundtrip",
    runtime: "python",
    updated_at: "2026-04-20T09:00:00Z",
  },
];

const botDetail = {
  bot: {
    ...botCatalog[0],
    versions: [
      {
        bot_id: "baseline-roundtrip",
        config_schema: {
          tick_interval_ms: { minimum: 0, type: "integer" },
          trade_notional: { minimum: 10, type: "number" },
        },
        default_config: {
          tick_interval_ms: 250,
          trade_notional: 1000,
        },
        description: "Seeded benchmark version.",
        entrypoint: "baseline_roundtrip_v1",
        title: "Baseline Roundtrip v1",
        updated_at: "2026-04-20T09:00:00Z",
        version: "v1",
      },
    ],
  },
};

const paperRules = {
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
    slippage_rate: 0.002,
  },
};

const scenarioCatalog = {
  scenarios: [
    {
      description: "Balanced smoke scenario.",
      ended_at: "2026-04-20T09:05:00Z",
      name: "Baseline",
      scenario_id: "baseline",
      started_at: "2026-04-20T09:00:00Z",
      symbols: ["BTCUSDT", "ETHUSDT"],
      tags: ["smoke"],
      tick_count: 4,
    },
  ],
};

const executionProfile = {
  fee_rate: 0.001,
  initial_balance: 10000,
  risk_controls: {
    allowed_symbols: [],
    cooldown_seconds: 0,
    max_daily_loss: 0,
    max_open_notional: 0,
    max_order_notional: 0,
    max_position_quantity: 0,
  },
  slippage_rate: 0.002,
};

const marketProfile = {
  max_fill_notional_per_tick: 2500,
  signal_latency_ticks: 1,
  spread_bps: 5,
};

test("runs route creates a run and opens detail", async ({ page }) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  await mockJson(page, "**/core/api/sim/bots", { bots: botCatalog });
  await mockJson(page, "**/core/api/sim/bots/baseline-roundtrip", botDetail);
  await mockJson(page, "**/core/api/paper/rules", paperRules);
  await mockJson(page, "**/data/api/data/market/quotes/replay/catalog", scenarioCatalog);
  await mockJson(page, "**/core/api/sim/runs?*", {
    runs: [
      {
        bot_id: "baseline-roundtrip",
        bot_name: "Baseline Roundtrip",
        bot_version: "v1",
        run_id: "sim-run-existing",
        scenario_id: "baseline",
        session_id: "sim-run-existing",
        started_at: "2026-04-20T09:30:00Z",
        status: "completed",
        updated_at: "2026-04-20T09:35:00Z",
      },
    ],
  });
  await mockJson(page, "**/core/api/sim/runs/sim-run-created", {
    run: {
      bot_id: "baseline-roundtrip",
      bot_name: "Baseline Roundtrip",
      bot_version: "v1",
      config_snapshot: {
        tick_interval_ms: 250,
        trade_notional: 1000,
      },
      execution_profile_snapshot: executionProfile,
      market_profile_snapshot: marketProfile,
      metrics_snapshot: {
        fees_paid: 2.5,
        filled_orders: 2,
        max_drawdown: 80,
        realized_pnl: 75,
        rejected_signals: 0,
        slippage_cost: 0.5,
        total_pnl: 75,
        unrealized_pnl: 0,
      },
      run_id: "sim-run-created",
      scenario_id: "baseline",
      session_id: "sim-run-created",
      started_at: "2026-04-20T10:00:00Z",
      status: "running",
      updated_at: "2026-04-20T10:00:00Z",
    },
  });
  await mockJson(page, "**/core/api/paper/report?session_id=sim-run-created", {
    report: {
      fees_paid: 2.5,
      filled_orders: 2,
      max_drawdown: 80,
      realized_pnl: 75,
      rejected_signals: 0,
      reset_count: 0,
      session_id: "sim-run-created",
      slippage_cost: 0.5,
      started_at: "2026-04-20T10:00:00Z",
      status: "running",
      symbols: [],
      timeline: [],
      total_pnl: 75,
      unrealized_pnl: 0,
    },
  });
  await mockJson(page, "**/core/api/paper/audit?session_id=sim-run-created*", {
    events: [],
  });
  await mockJson(page, "**/core/api/paper/timeline?session_id=sim-run-created*", {
    timeline: [],
  });
  await mockJsonHandler(page, "**/core/api/sim/runs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    await fulfillJson(
      route,
      {
        run: {
          bot_id: "baseline-roundtrip",
          bot_name: "Baseline Roundtrip",
          bot_version: "v1",
          config_snapshot: {
            tick_interval_ms: 250,
            trade_notional: 1000,
          },
          execution_profile_snapshot: executionProfile,
          market_profile_snapshot: marketProfile,
          run_id: "sim-run-created",
          scenario_id: "baseline",
          session_id: "sim-run-created",
          started_at: "2026-04-20T10:00:00Z",
          status: "running",
          updated_at: "2026-04-20T10:00:00Z",
        },
      },
      201,
    );
  });

  await page.goto("/runs");

  await expect(page.getByRole("heading", { name: /Single runs turn the paper engine/i })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Baseline Roundtrip" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Open detail" })).toBeVisible();

  await page.getByRole("button", { name: "Start run" }).click();

  await expect(page).toHaveURL(/\/runs\/sim-run-created$/);
  await expect(page.getByRole("heading", { name: "sim-run-created" })).toBeVisible();
  await expect(page.getByText("Execution and market snapshot")).toBeVisible();
});
