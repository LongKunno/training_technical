import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  installEventSourceMock,
  mockJson,
  mockJsonHandler,
  mockPlatformHealth,
} from "./support";

const botsPayload = {
  bots: [
    {
      bot_id: "baseline-roundtrip",
      current_version: "v1",
      default_scenario: "baseline",
      description: "Reference benchmark bot.",
      name: "Baseline Roundtrip",
      runtime: "python",
      updated_at: "2026-04-20T09:00:00Z",
    },
    {
      bot_id: "buy-and-hold",
      current_version: "v1",
      default_scenario: "trend-up",
      description: "Long-only seeded bot.",
      name: "Buy And Hold",
      runtime: "python",
      updated_at: "2026-04-20T09:00:00Z",
    },
  ],
};

const paperRulesPayload = {
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

const scenariosPayload = {
  scenarios: [
    {
      description: "Balanced smoke scenario.",
      ended_at: "2026-04-20T09:05:00Z",
      microstructure_profile: {
        max_fill_notional_per_tick: 2500,
        signal_latency_ticks: 1,
        spread_bps: 5,
      },
      name: "Baseline",
      scenario_id: "baseline",
      started_at: "2026-04-20T09:00:00Z",
      symbols: ["BTCUSDT", "ETHUSDT"],
      tags: ["smoke"],
      tick_count: 4,
    },
    {
      description: "Choppy scenario for moving averages.",
      ended_at: "2026-04-20T10:05:00Z",
      microstructure_profile: {
        max_fill_notional_per_tick: 1500,
        signal_latency_ticks: 2,
        spread_bps: 12,
      },
      name: "Range Chop",
      scenario_id: "range-chop",
      started_at: "2026-04-20T10:00:00Z",
      symbols: ["BTCUSDT"],
      tags: ["range"],
      tick_count: 6,
    },
  ],
};

test("experiments route keeps list filters in the URL across refresh", async ({
  page,
}) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  await mockJson(page, "**/core/api/sim/bots", botsPayload);
  await mockJson(page, "**/core/api/paper/rules", paperRulesPayload);
  await mockJson(
    page,
    "**/data/api/data/market/quotes/replay/catalog",
    scenariosPayload,
  );
  await mockJson(page, "**/core/api/sim/experiments?*", {
    experiments: [
      {
        active_run_id: "",
        completed_runs: 4,
        created_at: "2026-04-20T09:00:00Z",
        experiment_id: "sim-exp-existing",
        failed_runs: 0,
        name: "Existing benchmark",
        planned_runs: 4,
        status: "completed",
        stopped_runs: 0,
        updated_at: "2026-04-20T09:20:00Z",
      },
      {
        active_run_id: "",
        completed_runs: 0,
        created_at: "2026-04-20T10:00:00Z",
        experiment_id: "sim-exp-queued",
        failed_runs: 0,
        name: "Queued benchmark",
        planned_runs: 8,
        queue_position: 1,
        status: "queued",
        stopped_runs: 0,
        updated_at: "2026-04-20T10:00:00Z",
      },
    ],
  });

  await page.goto("/experiments?q=Existing&status=completed&sort=name_asc");

  const statusSelect = page.locator("select").filter({
    has: page.locator('option[value="completed"]'),
  });
  const sortSelect = page.locator("select").filter({
    has: page.locator('option[value="name_asc"]'),
  });

  await expect(page.getByLabel("Search batches")).toHaveValue("Existing");
  await expect(statusSelect).toHaveValue("completed");
  await expect(sortSelect).toHaveValue("name_asc");
  await expect(page.getByRole("link", { name: "Existing benchmark" })).toBeVisible();
  await expect(page.getByRole("link", { name: "Queued benchmark" })).toHaveCount(0);

  await page.reload();

  await expect(page.getByLabel("Search batches")).toHaveValue("Existing");
  await expect(statusSelect).toHaveValue("completed");
  await expect(sortSelect).toHaveValue("name_asc");
  await expect(page.getByRole("link", { name: "Existing benchmark" })).toBeVisible();

  await statusSelect.selectOption("queued");

  await expect(page).toHaveURL(/status=queued/);
  await expect(page.getByText("No matching experiments")).toBeVisible();
});

test("experiments route distinguishes list API errors from an empty queue", async ({
  page,
}) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  await mockJson(page, "**/core/api/sim/bots", botsPayload);
  await mockJson(page, "**/core/api/paper/rules", paperRulesPayload);
  await mockJson(
    page,
    "**/data/api/data/market/quotes/replay/catalog",
    scenariosPayload,
  );
  await mockJsonHandler(page, "**/core/api/sim/experiments?*", async (route) => {
    await fulfillJson(
      route,
      {
        error: {
          code: "experiments_unavailable",
          message: "experiment queue unavailable",
        },
      },
      503,
    );
  });

  await page.goto("/experiments");

  await expect(
    page.getByText("Experiment queue unavailable").first(),
  ).toBeVisible();
  await expect(page.getByText("experiment queue unavailable").first()).toBeVisible();
  await expect(page.getByText("No matching experiments")).toHaveCount(0);
});

test("experiments route previews the matrix and opens created batch detail", async ({
  page,
}) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  let experiments = [
    {
      active_run_id: "",
      completed_runs: 4,
      created_at: "2026-04-20T09:00:00Z",
      experiment_id: "sim-exp-existing",
      failed_runs: 0,
      name: "Existing benchmark",
      planned_runs: 4,
      status: "completed",
      stopped_runs: 0,
      updated_at: "2026-04-20T09:20:00Z",
    },
  ];

  let experimentDetail = {
    active_run_id: "sim-run-exp-1",
    completed_at: undefined,
    completed_runs: 0,
    created_at: "2026-04-21T10:00:00Z",
    current_index: 0,
    execution_profile_snapshot: paperRulesPayload.rules,
    experiment_id: "sim-exp-created",
    failed_runs: 0,
    name: "Matrix batch",
    planned_runs: 8,
    runs: [
      {
        bot_id: "baseline-roundtrip",
        bot_name: "Baseline Roundtrip",
        bot_version: "v1",
        experiment_id: "sim-exp-created",
        run_id: "sim-run-exp-1",
        scenario_id: "baseline",
        session_id: "sim-run-exp-1",
        started_at: "2026-04-21T10:00:00Z",
        status: "running",
        updated_at: "2026-04-21T10:00:05Z",
      },
    ],
    slots: [
      {
        bot_id: "baseline-roundtrip",
        bot_name: "Baseline Roundtrip",
        bot_version: "v1",
        config_snapshot: { trade_notional: 1000 },
        repetition: 1,
        scenario_id: "baseline",
        slot_index: 0,
      },
    ],
    started_at: "2026-04-21T10:00:00Z",
    status: "running",
    stop_requested: false,
    stopped_runs: 0,
    updated_at: "2026-04-21T10:00:05Z",
  };

  await mockJson(page, "**/core/api/sim/bots", botsPayload);
  await mockJson(page, "**/core/api/paper/rules", paperRulesPayload);
  await mockJson(
    page,
    "**/data/api/data/market/quotes/replay/catalog",
    scenariosPayload,
  );

  let releaseCreateExperiment = () => {};
  const createExperimentGate = new Promise<void>((resolve) => {
    releaseCreateExperiment = resolve;
  });
  await mockJsonHandler(
    page,
    /\/core\/api\/sim\/experiments(?:\?.*)?$/,
    async (route) => {
      if (route.request().method() === "POST") {
        await createExperimentGate;
        experiments = [experimentDetail, ...experiments];
        await fulfillJson(route, { experiment: experimentDetail }, 201);
        return;
      }

      await fulfillJson(route, { experiments });
    },
  );
  await mockJson(page, "**/core/api/sim/experiments/sim-exp-created", {
    experiment: experimentDetail,
  });
  await mockJson(page, "**/core/api/sim/experiments/sim-exp-created/summary", {
    rows: [
      {
        avg_max_drawdown: 12,
        avg_total_pnl: 120,
        best_total_pnl: 120,
        bot_id: "baseline-roundtrip",
        bot_version: "v1",
        completed_runs: 1,
        failed_runs: 0,
        scenario_id: "baseline",
        scheduled_runs: 2,
        stopped_runs: 0,
        worst_total_pnl: 120,
      },
    ],
  });

  await page.goto("/experiments");

  await expect(
    page.getByRole("heading", {
      name: /Plan and launch sequential experiments/i,
    }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Execution defaults" }),
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
  const matrixPresetGroup = page.getByRole("group", {
    name: "Experiment matrix presets",
  });
  await expect(
    matrixPresetGroup.getByRole("button", { name: /Smoke/ }),
  ).toBeVisible();
  await matrixPresetGroup
    .getByRole("button", { name: /Scenario coverage/ })
    .click();
  await expect(page.getByLabel("Experiment name")).toHaveValue(
    "Scenario coverage matrix",
  );
  await expect(page.getByLabel("Repetitions")).toHaveValue("2");
  await page.getByRole("button", { name: "Save template" }).click();
  let templateGroup = page.getByRole("group", {
    name: "Saved experiment templates",
  });
  await expect(templateGroup.getByText("Scenario coverage matrix")).toBeVisible();

  await page.getByRole("button", { name: "Reset planner" }).click();
  await expect(page.getByLabel("Experiment name")).toHaveValue("Baseline matrix");
  await templateGroup
    .getByRole("button", {
      name: "Apply template Scenario coverage matrix",
    })
    .click();
  await expect(page.getByLabel("Experiment name")).toHaveValue(
    "Scenario coverage matrix",
  );

  await page.reload();
  templateGroup = page.getByRole("group", {
    name: "Saved experiment templates",
  });
  await expect(templateGroup.getByText("Scenario coverage matrix")).toBeVisible();
  await templateGroup
    .getByRole("button", {
      name: "Delete template Scenario coverage matrix",
    })
    .click();
  await expect(page.getByText("No saved experiment templates yet.")).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Largest matrices" }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Existing benchmark" }),
  ).toBeVisible();

  await page.getByRole("checkbox", { name: /Baseline Roundtrip/i }).check();
  await page.getByRole("checkbox", { name: /Buy And Hold/i }).check();
  await page
    .getByRole("checkbox", { name: /Baseline\s+Balanced smoke/i })
    .check();
  await page.getByRole("checkbox", { name: /Range Chop/i }).check();

  await expect(
    page.getByText("8 planned run(s) across 4 lane(s)"),
  ).toBeVisible();

  await page.getByLabel("Experiment name").fill("Matrix batch");
  await page.getByRole("button", { name: "Start experiment" }).click();
  await expect(
    page.getByRole("button", { name: "Starting experiment..." }),
  ).toBeDisabled();
  await expect(page.getByRole("button", { name: "Reset planner" })).toBeDisabled();
  releaseCreateExperiment();

  await expect(page).toHaveURL(/\/experiments\/sim-exp-created$/);
  await expect(
    page.getByRole("heading", { name: "Matrix batch" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Experiment summary" }),
  ).toContainText("baseline-roundtrip");
});

test("experiment detail stops the active batch and refreshes the terminal state", async ({
  page,
}) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  let experimentDetail = {
    active_run_id: "sim-run-exp-1",
    completed_at: undefined,
    completed_runs: 1,
    created_at: "2026-04-21T10:00:00Z",
    current_index: 1,
    execution_profile_snapshot: paperRulesPayload.rules,
    experiment_id: "sim-exp-stop",
    failed_runs: 0,
    name: "Stop batch",
    planned_runs: 3,
    runs: [
      {
        bot_id: "baseline-roundtrip",
        bot_name: "Baseline Roundtrip",
        bot_version: "v1",
        experiment_id: "sim-exp-stop",
        run_id: "sim-run-exp-0",
        scenario_id: "baseline",
        session_id: "sim-run-exp-0",
        started_at: "2026-04-21T10:00:00Z",
        status: "completed",
        updated_at: "2026-04-21T10:00:20Z",
      },
      {
        bot_id: "baseline-roundtrip",
        bot_name: "Baseline Roundtrip",
        bot_version: "v1",
        experiment_id: "sim-exp-stop",
        run_id: "sim-run-exp-1",
        scenario_id: "range-chop",
        session_id: "sim-run-exp-1",
        started_at: "2026-04-21T10:01:00Z",
        status: "running",
        updated_at: "2026-04-21T10:01:05Z",
      },
    ],
    slots: [],
    started_at: "2026-04-21T10:00:00Z",
    status: "running",
    stop_requested: false,
    stopped_runs: 0,
    updated_at: "2026-04-21T10:01:05Z",
  };

  await mockJson(page, "**/core/api/sim/bots", botsPayload);
  await mockJson(
    page,
    "**/data/api/data/market/quotes/replay/catalog",
    scenariosPayload,
  );
  await mockJsonHandler(
    page,
    "**/core/api/sim/experiments/sim-exp-stop",
    async (route) => {
      await fulfillJson(route, { experiment: experimentDetail });
    },
  );
  await mockJson(page, "**/core/api/sim/experiments/sim-exp-stop/summary", {
    rows: [
      {
        avg_cancel_rate: 0,
        avg_fill_ratio: 1,
        avg_max_drawdown: 10,
        avg_slippage_bps: 2.5,
        avg_total_pnl: 100,
        best_total_pnl: 100,
        bot_id: "baseline-roundtrip",
        bot_version: "v1",
        completed_runs: 1,
        confidence_interval_95_total_pnl: 0,
        failed_runs: 0,
        failure_rate: 0,
        scenario_id: "baseline",
        scheduled_runs: 1,
        stddev_total_pnl: 0,
        stopped_runs: 0,
        worst_total_pnl: 100,
      },
      {
        avg_cancel_rate: 0,
        avg_fill_ratio: 0,
        avg_max_drawdown: 0,
        avg_slippage_bps: 0,
        avg_total_pnl: 0,
        best_total_pnl: 0,
        bot_id: "baseline-roundtrip",
        bot_version: "v1",
        completed_runs: 0,
        confidence_interval_95_total_pnl: 0,
        failed_runs: 0,
        failure_rate: 0,
        scenario_id: "range-chop",
        scheduled_runs: 1,
        stddev_total_pnl: 0,
        stopped_runs: 1,
        worst_total_pnl: 0,
      },
    ],
  });
  await mockJsonHandler(
    page,
    "**/core/api/sim/experiments/sim-exp-stop/stop",
    async (route) => {
      experimentDetail = {
        ...experimentDetail,
        active_run_id: "",
        completed_at: "2026-04-21T10:02:00Z",
        current_index: 2,
        runs: experimentDetail.runs.map((run) =>
          run.run_id === "sim-run-exp-1"
            ? { ...run, status: "stopped", updated_at: "2026-04-21T10:02:00Z" }
            : run,
        ),
        status: "stopped",
        stop_requested: true,
        stopped_runs: 1,
        updated_at: "2026-04-21T10:02:00Z",
      };
      await fulfillJson(route, { experiment: experimentDetail });
    },
  );

  await page.goto("/experiments/sim-exp-stop");

  await expect(
    page.getByRole("button", { name: "Stop experiment" }),
  ).toBeVisible();
  await expect(page.getByRole("button", { name: "Batch rules" })).toBeVisible();
  await expect(page.getByRole("link", { name: "sim-run-exp-0" })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Open active run" }),
  ).toBeVisible();

  await page.getByLabel("Search lanes").fill("range-chop");
  await expect(
    page.getByRole("table", { name: "Experiment summary" }),
  ).toContainText("range-chop");
  await expect(
    page.getByRole("table", { name: "Experiment summary" }),
  ).not.toContainText("v1 · baseline");
  await page.getByLabel("Search lanes").fill("");
  await page.locator("select").filter({
    has: page.locator('option[value="fill_ratio_desc"]'),
  }).selectOption("fill_ratio_desc");
  await expect(
    page.getByRole("table", { name: "Experiment summary" }),
  ).toContainText("Fill ratio");
  await page.locator("select").filter({
    has: page.locator('option[value="confidence_asc"]'),
  }).selectOption("confidence_asc");
  await expect(
    page.getByRole("table", { name: "Experiment summary" }),
  ).toContainText("PnL CI");

  const csvDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export CSV" }).click();
  const csvDownload = await csvDownloadPromise;
  expect(csvDownload.suggestedFilename()).toBe(
    "experiment-sim-exp-stop-summary.csv",
  );

  const jsonDownloadPromise = page.waitForEvent("download");
  await page.getByRole("button", { name: "Export JSON" }).click();
  const jsonDownload = await jsonDownloadPromise;
  expect(jsonDownload.suggestedFilename()).toBe(
    "experiment-sim-exp-stop-summary.json",
  );

  await page.getByLabel("Search child runs").fill("sim-run-exp-0");
  await expect(
    page.getByRole("table", { name: "Experiment child runs" }),
  ).toContainText("sim-run-exp-0");
  await expect(
    page.getByRole("table", { name: "Experiment child runs" }),
  ).not.toContainText("sim-run-exp-1");
  await page.getByLabel("Search child runs").fill("");

  await page.getByRole("button", { name: "Stop experiment" }).click();
  await page.getByRole("button", { name: "Confirm stop" }).click();

  await expect(
    page.getByRole("table", { name: "Experiment child runs" }),
  ).toContainText("Stopped");
  await expect(page.getByText("No active child run")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop experiment" }),
  ).toHaveCount(0);
});

test("run detail links back to experiment detail", async ({ page }) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  await mockJson(page, "**/core/api/sim/runs/sim-run-child", {
    run: {
      bot_id: "baseline-roundtrip",
      bot_name: "Baseline Roundtrip",
      bot_version: "v1",
      config_snapshot: {
        tick_interval_ms: 250,
        trade_notional: 1000,
      },
      execution_profile_snapshot: paperRulesPayload.rules,
      experiment_id: "sim-exp-linked",
      market_profile_snapshot: {
        max_fill_notional_per_tick: 2500,
        signal_latency_ticks: 1,
        spread_bps: 5,
      },
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
      run_id: "sim-run-child",
      scenario_id: "baseline",
      session_id: "sim-run-child",
      started_at: "2026-04-21T10:00:00Z",
      status: "completed",
      updated_at: "2026-04-21T10:00:00Z",
    },
  });
  await mockJson(page, "**/core/api/paper/report?session_id=sim-run-child", {
    report: {
      fees_paid: 2.5,
      filled_orders: 2,
      max_drawdown: 80,
      realized_pnl: 75,
      rejected_signals: 0,
      reset_count: 0,
      session_id: "sim-run-child",
      slippage_cost: 0.5,
      started_at: "2026-04-21T10:00:00Z",
      status: "completed",
      symbols: [],
      timeline: [],
      total_pnl: 75,
      unrealized_pnl: 0,
    },
  });
  await mockJson(page, "**/core/api/paper/audit?session_id=sim-run-child*", {
    events: [],
  });
  await mockJson(page, "**/core/api/paper/timeline?session_id=sim-run-child*", {
    timeline: [],
  });
  await mockJson(page, "**/core/api/paper/orders?*session_id=sim-run-child*", {
    orders: [
      {
        account_id: "paper-account-1",
        executed_at: "2026-04-21T10:02:00Z",
        fee: 0.2,
        fee_rate: 0.001,
        fill_count: 1,
        id: "paper-order-1",
        notional: 200,
        price: 100,
        quantity: 2,
        remaining_quantity: 0,
        requested_notional: 200,
        requested_price: 100,
        requested_quantity: 2,
        session_id: "sim-run-child",
        side: "buy",
        slippage_rate: 0.002,
        status: "filled",
        symbol: "BTCUSDT",
      },
    ],
  });
  await mockJson(page, "**/core/api/sim/experiments/sim-exp-linked", {
    experiment: {
      active_run_id: "",
      completed_at: "2026-04-21T10:01:00Z",
      completed_runs: 1,
      created_at: "2026-04-21T10:00:00Z",
      current_index: 1,
      execution_profile_snapshot: paperRulesPayload.rules,
      experiment_id: "sim-exp-linked",
      failed_runs: 0,
      name: "Linked experiment",
      planned_runs: 1,
      runs: [],
      slots: [],
      started_at: "2026-04-21T10:00:00Z",
      status: "completed",
      stop_requested: false,
      stopped_runs: 0,
      updated_at: "2026-04-21T10:01:00Z",
    },
  });
  await mockJson(page, "**/core/api/sim/experiments/sim-exp-linked/summary", {
    rows: [],
  });

  await page.goto("/runs/sim-run-child");

  await expect(
    page.getByRole("button", { name: "Open experiment" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open experiment" }).click();

  await expect(page).toHaveURL(/\/experiments\/sim-exp-linked$/);
  await expect(
    page.getByRole("heading", { name: "Linked experiment" }),
  ).toBeVisible();
});

test("queued experiment detail shows queue ownership and can be stopped before launch", async ({
  page,
}) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  let experimentDetail = {
    active_run_id: "",
    completed_runs: 0,
    created_at: "2026-04-21T10:00:00Z",
    current_index: 0,
    execution_profile_snapshot: paperRulesPayload.rules,
    experiment_id: "sim-exp-queued",
    failed_runs: 0,
    name: "Queued batch",
    planned_runs: 2,
    queue_position: 2,
    runs: [],
    slots: [],
    started_at: undefined,
    status: "queued",
    stop_requested: false,
    stopped_runs: 0,
    updated_at: "2026-04-21T10:00:00Z",
  };

  await mockJsonHandler(
    page,
    "**/core/api/sim/experiments/sim-exp-queued",
    async (route) => {
      await fulfillJson(route, { experiment: experimentDetail });
    },
  );
  await mockJson(page, "**/core/api/sim/experiments/sim-exp-queued/summary", {
    rows: [],
  });
  await mockJsonHandler(
    page,
    "**/core/api/sim/experiments/sim-exp-queued/stop",
    async (route) => {
      experimentDetail = {
        ...experimentDetail,
        completed_at: "2026-04-21T10:05:00Z",
        status: "stopped",
        stop_requested: true,
        updated_at: "2026-04-21T10:05:00Z",
      };
      await fulfillJson(route, { experiment: experimentDetail });
    },
  );

  await page.goto("/experiments/sim-exp-queued");

  await expect(page.getByText("Waiting at queue position #2")).toBeVisible();
  await expect(page.getByText("Queued #2")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Stop experiment" }),
  ).toBeVisible();

  await page.getByRole("button", { name: "Stop experiment" }).click();
  await page.getByRole("button", { name: "Confirm stop" }).click();

  await expect(
    page.getByRole("button", { name: "Stop experiment" }),
  ).toHaveCount(0);
  await expect(
    page.getByText("This batch is either terminal or between child runs."),
  ).toBeVisible();
});

test("experiment detail shows a clear not-found state for missing deep links", async ({
  page,
}) => {
  await installEventSourceMock(page);
  await mockPlatformHealth(page);

  const missingExperimentPayload = {
    error: {
      code: "experiment_not_found",
      message: "simulation experiment not found",
    },
  };

  await mockJsonHandler(
    page,
    "**/core/api/sim/experiments/sim-exp-missing",
    async (route) => {
      await fulfillJson(route, missingExperimentPayload, 404);
    },
  );
  await mockJsonHandler(
    page,
    "**/core/api/sim/experiments/sim-exp-missing/summary",
    async (route) => {
      await fulfillJson(route, missingExperimentPayload, 404);
    },
  );

  await page.goto("/experiments/sim-exp-missing");

  await expect(
    page.getByRole("heading", { name: "Experiment not found" }),
  ).toBeVisible();
  await expect(page.getByText("The requested item was not found")).toBeVisible();
});
