import { expect, test } from "@playwright/test";

import { fulfillJson, mockJson, mockJsonHandler } from "./support";

test("lab route runs operator actions and records activity locally", async ({ page }) => {
  let currentSession = {
    id: "paper-live",
    last_event_at: "2026-04-18T09:05:00Z",
    reset_count: 0,
    started_at: "2026-04-18T09:00:00Z",
    status: "running",
  };

  await mockJsonHandler(page, "**/core/api/paper/session", async (route) => {
    await fulfillJson(route, { session: currentSession });
  });
  await mockJson(page, "**/data/api/data/market/quotes/replay/scenarios", {
    scenarios: ["baseline", "volatility-spike"],
  });
  await mockJson(page, "**/data/api/data/strategy/signals/scenarios", {
    scenarios: ["baseline"],
  });
  await mockJson(page, "**/data/api/data/strategy/signals?*", {
    signals: [
      {
        notional: 0,
        price_hint: 101,
        quantity: 1,
        scenario: "baseline",
        side: "buy",
        signal_id: "sig-1",
        strategy_id: "baseline-trend",
        symbol: "BTCUSDT",
        timestamp: "2026-04-18T09:10:00Z",
      },
    ],
  });
  await mockJsonHandler(page, "**/core/api/paper/session/start", async (route) => {
    currentSession = {
      ...currentSession,
      id: "paper-alpha-live",
      last_event_at: "2026-04-18T09:15:00Z",
      status: "running",
    };

    await fulfillJson(route, { session: currentSession }, 201);
  });
  await mockJson(page, "**/data/api/data/market/quotes/publish", {
    published_count: 1,
    scenario: "baseline",
    symbols: ["BTCUSDT"],
    transport: "both",
    transports: ["http", "kafka"],
  });
  await mockJson(page, "**/core/internal/signals", {
    execution: {
      signal_id: "manual-signal-1",
      status: "accepted",
      strategy_id: "manual-console",
    },
  });

  await page.goto("/lab");

  await expect(page.getByRole("heading", { name: "Current session control" })).toBeVisible();
  await expect(page.getByRole("cell", { name: "baseline-trend" })).toBeVisible();

  await page.getByLabel("Session ID").fill("paper-alpha-live");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("Session started", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Publish latest" }).click();
  await expect(page.getByText("Market publish completed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Send signal" }).click();
  await expect(page.getByText("Manual signal sent", { exact: true })).toBeVisible();
});
