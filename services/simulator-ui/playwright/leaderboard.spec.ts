import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  mockJson,
  mockJsonHandler,
  mockPlatformHealth,
} from "./support";

test("leaderboard keeps single-run rules collapsed and renders quick-scan charts", async ({
  page,
}) => {
  await mockPlatformHealth(page);

  await mockJson(page, "**/core/api/sim/bots", {
    bots: [
      {
        bot_id: "bot-alpha",
        current_version: "v1",
        default_scenario: "scenario-btc",
        description: "Alpha",
        name: "Alpha Bot",
        runtime: "python",
        updated_at: "2026-04-18T09:00:00Z",
      },
      {
        bot_id: "bot-beta",
        current_version: "v2",
        default_scenario: "scenario-eth",
        description: "Beta",
        name: "Beta Bot",
        runtime: "python",
        updated_at: "2026-04-18T09:00:00Z",
      },
    ],
  });
  await mockJson(page, "**/data/api/data/market/quotes/replay/catalog", {
    scenarios: [
      {
        description: "BTC replay",
        name: "BTC Trend",
        scenario_id: "scenario-btc",
      },
      {
        description: "ETH replay",
        name: "ETH Mean",
        scenario_id: "scenario-eth",
      },
    ],
  });
  await mockJson(page, "**/core/api/sim/leaderboard?*", {
    rows: [
      {
        bot_id: "bot-alpha",
        bot_name: "Alpha Bot",
        bot_version: "v1",
        completed_at: "2026-04-18T10:10:00Z",
        metrics_snapshot: {
          fees_paid: 5,
          filled_orders: 4,
          max_drawdown: 45,
          realized_pnl: 220,
          rejected_signals: 0,
          slippage_cost: 3,
          total_pnl: 260,
          unrealized_pnl: 0,
        },
        run_id: "run-alpha-1",
        scenario_id: "scenario-btc",
        session_id: "paper-alpha-1",
        started_at: "2026-04-18T10:00:00Z",
        status: "completed",
        updated_at: "2026-04-18T10:12:00Z",
      },
      {
        bot_id: "bot-beta",
        bot_name: "Beta Bot",
        bot_version: "v2",
        completed_at: "2026-04-18T09:40:00Z",
        metrics_snapshot: {
          fees_paid: 4,
          filled_orders: 3,
          max_drawdown: 30,
          realized_pnl: 120,
          rejected_signals: 0,
          slippage_cost: 2,
          total_pnl: 140,
          unrealized_pnl: 0,
        },
        run_id: "run-beta-1",
        scenario_id: "scenario-eth",
        session_id: "paper-beta-1",
        started_at: "2026-04-18T09:20:00Z",
        status: "completed",
        updated_at: "2026-04-18T09:45:00Z",
      },
    ],
  });

  await page.goto("/leaderboard");

  await expect(page.getByRole("heading", { name: "Standalone run leaderboard" })).toBeVisible();
  await expect(page.getByRole("complementary").getByText("Simulation", { exact: true })).toBeVisible();
  await expect(page.getByRole("link", { name: "Leaderboard" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Top performers" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Lowest drawdown leaders" })).toBeVisible();
  await expect(page.getByText("Leaderboard này chỉ nhận", { exact: false })).toHaveCount(0);
  await page.getByRole("button", { name: "View rules" }).click();
  await expect(page.getByText("Leaderboard này chỉ nhận", { exact: false })).toBeVisible();
  await expect(page.getByRole("cell", { name: "run-alpha-1" })).toBeVisible();
  await expect(page.getByText("Best total PnL")).toBeVisible();
  await expect(page.getByText("+$260.00").first()).toBeVisible();
});

test("leaderboard distinguishes API errors from an empty ranking", async ({
  page,
}) => {
  await mockPlatformHealth(page);

  await mockJson(page, "**/core/api/sim/bots", { bots: [] });
  await mockJson(page, "**/data/api/data/market/quotes/replay/catalog", {
    scenarios: [],
  });
  await mockJsonHandler(page, "**/core/api/sim/leaderboard?*", async (route) => {
    await fulfillJson(
      route,
      {
        error: {
          code: "leaderboard_unavailable",
          message: "leaderboard database unavailable",
        },
      },
      503,
    );
  });

  await page.goto("/leaderboard");

  await expect(page.getByText("Leaderboard unavailable").first()).toBeVisible();
  await expect(page.getByText("leaderboard database unavailable")).toHaveCount(0);
  await expect(page.getByText("No completed runs yet")).toHaveCount(0);
});
