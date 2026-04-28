import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installEventSourceMock,
  mockJson,
  mockJsonHandler,
  mockPlatformHealth,
} from "./support";

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
      microstructure_profile: {
        max_fill_notional_per_tick: 2500,
        signal_latency_ticks: 1,
        spread_bps: 5,
      },
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

test("runs route keeps list filters in the URL across refresh", async ({
  page,
}) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  await mockJson(page, "**/core/api/sim/bots", { bots: botCatalog });
  await mockJson(page, "**/core/api/sim/bots/baseline-roundtrip", botDetail);
  await mockJson(page, "**/core/api/paper/rules", paperRules);
  await mockJson(
    page,
    "**/data/api/data/market/quotes/replay/catalog",
    scenarioCatalog,
  );
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
      {
        bot_id: "baseline-roundtrip",
        bot_name: "Baseline Roundtrip",
        bot_version: "v1",
        run_id: "sim-run-failed",
        scenario_id: "baseline",
        session_id: "sim-run-failed",
        started_at: "2026-04-20T08:30:00Z",
        status: "failed",
        updated_at: "2026-04-20T08:35:00Z",
      },
    ],
  });

  await page.goto(
    "/runs?q=existing&status=completed&bot_id=baseline-roundtrip&scenario_id=baseline&sort=run_asc",
  );

  const statusSelect = page.locator("select").filter({
    has: page.locator('option[value="completed"]'),
  });
  const sortSelect = page.locator("select").filter({
    has: page.locator('option[value="run_asc"]'),
  });

  await expect(page.getByLabel("Search")).toHaveValue("existing");
  await expect(statusSelect).toHaveValue("completed");
  await expect(sortSelect).toHaveValue("run_asc");
  await expect(page.getByText("sim-run-existing").first()).toBeVisible();
  await expect(page.getByText("sim-run-failed")).toHaveCount(0);

  await page.reload();

  await expect(page.getByLabel("Search")).toHaveValue("existing");
  await expect(statusSelect).toHaveValue("completed");
  await expect(sortSelect).toHaveValue("run_asc");
  await expect(page.getByText("sim-run-existing").first()).toBeVisible();

  await statusSelect.selectOption("failed");

  await expect(page).toHaveURL(/status=failed/);
  await expect(page.getByText("No matching runs")).toBeVisible();
});

test("runs table stays contained on narrow viewports with long data", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  await mockJson(page, "**/core/api/sim/bots", { bots: botCatalog });
  await mockJson(page, "**/core/api/sim/bots/baseline-roundtrip", botDetail);
  await mockJson(page, "**/core/api/paper/rules", paperRules);
  await mockJson(
    page,
    "**/data/api/data/market/quotes/replay/catalog",
    scenarioCatalog,
  );
  await mockJson(page, "**/core/api/sim/runs?*", {
    runs: [
      {
        bot_id: "baseline-roundtrip",
        bot_name: "Baseline Roundtrip",
        bot_version: "v1",
        error_message:
          "runner_lost after heartbeat timeout while replaying liquidity stress scenario",
        experiment_id:
          "sim-exp-super-long-owned-batch-identifier-for-responsive-check",
        run_id:
          "sim-run-super-long-identifier-for-responsive-table-check-0000000001",
        scenario_id:
          "baseline-with-extra-long-scenario-label-for-responsive-check",
        session_id:
          "paper-session-super-long-identifier-for-responsive-table-check-0000000001",
        started_at: "2026-04-20T09:30:00Z",
        status: "failed",
        updated_at: "2026-04-20T09:35:00Z",
      },
    ],
  });

  await page.goto("/runs");

  const table = page.getByRole("table", { name: "Simulation runs" });
  await expect(table).toBeVisible();

  const documentScrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth,
  );
  const viewportWidth = await page.evaluate(() => window.innerWidth);
  expect(documentScrollWidth).toBeLessThanOrEqual(viewportWidth + 1);

  const tableScroller = await table.locator("xpath=..").evaluate((node) => ({
    clientWidth: node.clientWidth,
    scrollWidth: node.scrollWidth,
  }));
  expect(tableScroller.scrollWidth).toBeGreaterThan(tableScroller.clientWidth);
});

test("runs route distinguishes list API errors from an empty queue", async ({
  page,
}) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  await mockJson(page, "**/core/api/sim/bots", { bots: botCatalog });
  await mockJson(page, "**/core/api/sim/bots/baseline-roundtrip", botDetail);
  await mockJson(page, "**/core/api/paper/rules", paperRules);
  await mockJson(
    page,
    "**/data/api/data/market/quotes/replay/catalog",
    scenarioCatalog,
  );
  await mockJsonHandler(page, "**/core/api/sim/runs?*", async (route) => {
    await fulfillJson(
      route,
      {
        error: {
          code: "runs_unavailable",
          message: "simulation run queue unavailable",
        },
      },
      503,
    );
  });

  await page.goto("/runs");

  await expect(page.getByText("Run queue unavailable").first()).toBeVisible();
  await expect(page.getByText("simulation run queue unavailable")).toHaveCount(0);
  await expect(page.getByText("No matching runs")).toHaveCount(0);
});

test("runs route creates a run and opens detail", async ({ page }) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  await mockJson(page, "**/core/api/sim/bots", { bots: botCatalog });
  await mockJson(page, "**/core/api/sim/bots/baseline-roundtrip", botDetail);
  await mockJson(page, "**/core/api/paper/rules", paperRules);
  await mockJson(
    page,
    "**/data/api/data/market/quotes/replay/catalog",
    scenarioCatalog,
  );
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
  let stopRequests = 0;
  let createdRun = {
    bot_id: "baseline-roundtrip",
    bot_name: "Baseline Roundtrip",
    bot_version: "v1",
    completed_at: "",
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
    stopped_reason: "",
    updated_at: "2026-04-20T10:00:00Z",
  };
  await mockJsonHandler(page, "**/core/api/sim/runs/sim-run-created", async (route) => {
    await fulfillJson(route, { run: createdRun });
  });
  await mockJsonHandler(page, "**/core/api/sim/runs/sim-run-created/stop", async (route) => {
    stopRequests += 1;
    createdRun = {
      ...createdRun,
      completed_at: "2026-04-20T10:03:00Z",
      status: "stopped",
      stopped_reason: "operator_stop",
      updated_at: "2026-04-20T10:03:00Z",
    };
    await fulfillJson(route, { run: createdRun });
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
  await mockJson(
    page,
    "**/core/api/paper/timeline?session_id=sim-run-created*",
    {
      timeline: [],
    },
  );
  await mockJson(page, "**/core/api/paper/orders?*session_id=sim-run-created*", {
    orders: [
      {
        account_id: "paper-account-1",
        executed_at: "2026-04-20T10:02:00Z",
        fee: 0.15,
        fee_rate: 0.001,
        fill_count: 2,
        id: "paper-order-1",
        notional: 151.5,
        price: 101,
        quantity: 1.5,
        remaining_quantity: 0.5,
        requested_notional: 200,
        requested_price: 100,
        requested_quantity: 2,
        session_id: "sim-run-created",
        side: "buy",
        slippage_rate: 0.002,
        status: "stopped",
        symbol: "BTCUSDT",
        terminal_reason: "cancel_after_ticks",
      },
    ],
  });
  let releaseCreateRun = () => {};
  const createRunGate = new Promise<void>((resolve) => {
    releaseCreateRun = resolve;
  });
  await mockJsonHandler(page, "**/core/api/sim/runs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    await createRunGate;
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

  await expect(
    page.getByRole("heading", { name: /Plan and launch one standalone run/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: /Bot config/ }).first(),
  ).toBeVisible();
  await page.getByRole("button", { name: "Execution defaults" }).click();
  const presetGroup = page.getByRole("group", {
    name: "Execution profile presets",
  });
  await expect(
    presetGroup.getByRole("button", { name: "Default" }),
  ).toHaveAttribute("aria-pressed", "true");
  await presetGroup.getByRole("button", { name: "Conservative" }).click();
  await expect(page.getByLabel("Fee rate")).toHaveValue("0.0015");
  await expect(page.getByLabel("Slippage rate")).toHaveValue("0.003");
  await presetGroup.getByRole("button", { name: "Aggressive" }).click();
  await expect(page.getByLabel("Fee rate")).toHaveValue("0.0005");
  await expect(page.getByLabel("Slippage rate")).toHaveValue("0.001");
  await expect(page.getByText("Baseline Roundtrip · v1")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open detail" })).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Status distribution" }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Standalone vs batch child" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Start run" }).click();
  await expect(
    page.getByRole("button", { name: "Starting run..." }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reset planner" })).toBeDisabled();
  releaseCreateRun();

  await expect(page).toHaveURL(/\/runs\/sim-run-created$/);
  await expect(
    page.getByRole("heading", { name: "sim-run-created" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Stop run" }).click();
  await expect(page.getByRole("button", { name: "Confirm stop" })).toBeVisible();
  expect(stopRequests).toBe(0);
  await expect(page.getByText("Confirm stop to halt this run")).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Stop run" })).toBeVisible();

  await page.getByRole("button", { name: "Stop run" }).click();
  await page.getByRole("button", { name: "Confirm stop" }).click();
  await expect(page.getByText("Stop reason: operator_stop")).toBeVisible();
  expect(stopRequests).toBe(1);
  await expect(
    page.getByRole("button", { name: "Execution and market snapshot" }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Execution and market snapshot" })
    .click();
  await expect(page.getByText("Market microstructure")).toBeVisible();
  await page.getByRole("tab", { name: /Orders/ }).click();
  await expect(page.getByRole("table", { name: "Run orders" })).toContainText(
    "cancel after ticks",
  );
  await expect(page.getByRole("table", { name: "Run orders" })).toContainText(
    "2 fills",
  );
});

test("runs route explains scheduler conflict and keeps advanced fields collapsed", async ({
  page,
}) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  await mockJson(page, "**/core/api/sim/bots", { bots: botCatalog });
  await mockJson(page, "**/core/api/sim/bots/baseline-roundtrip", botDetail);
  await mockJson(page, "**/core/api/paper/rules", paperRules);
  await mockJson(
    page,
    "**/data/api/data/market/quotes/replay/catalog",
    scenarioCatalog,
  );
  await mockJson(page, "**/core/api/sim/runs?*", {
    runs: [
      {
        bot_id: "baseline-roundtrip",
        bot_name: "Baseline Roundtrip",
        bot_version: "v1",
        experiment_id: "sim-exp-busy",
        run_id: "sim-run-batch-child",
        scenario_id: "baseline",
        session_id: "sim-run-batch-child",
        started_at: "2026-04-20T09:30:00Z",
        status: "running",
        updated_at: "2026-04-20T09:35:00Z",
      },
    ],
  });
  await mockJsonHandler(page, "**/core/api/sim/runs", async (route) => {
    if (route.request().method() !== "POST") {
      await route.fallback();
      return;
    }

    await fulfillJson(
      route,
      {
        error: {
          code: "simulation_busy",
          message: "engine is busy",
        },
      },
      409,
    );
  });

  await page.goto("/runs");

  await expect(page.getByText("Cooldown seconds")).toHaveCount(0);
  await page.getByRole("button", { name: "Execution defaults" }).click();
  await expect(page.getByText("Cooldown seconds")).toBeVisible();
  await page.getByRole("button", { name: "Start run" }).click();
  await expect(
    page.locator("form").getByText("Scheduler conflict:", { exact: false }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Standalone vs batch child" }),
  ).toBeVisible();
  await expect(page.getByText("Owned by sim-exp-busy")).toBeVisible();
});

test("run detail shows a clear not-found state for missing deep links", async ({
  page,
}) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  await mockJsonHandler(page, "**/core/api/sim/runs/sim-run-missing", async (route) => {
    await fulfillJson(
      route,
      {
        error: {
          code: "run_not_found",
          message: "simulation run not found",
        },
      },
      404,
    );
  });

  await page.goto("/runs/sim-run-missing");

  await expect(
    page.getByRole("heading", { name: "Run not found" }),
  ).toBeVisible();
  await expect(page.getByText("The requested item was not found")).toBeVisible();
});
