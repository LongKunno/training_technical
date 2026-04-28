import { expect, test } from "@playwright/test";

import { fulfillJson, mockJson, mockJsonHandler, mockPlatformHealth } from "./support";

test("lab route runs operator actions and records activity locally", async ({ page }) => {
  let currentSession = {
    id: "paper-live",
    last_event_at: "2026-04-18T09:05:00Z",
    reset_count: 0,
    started_at: "2026-04-18T09:00:00Z",
    status: "running",
  };

  await mockPlatformHealth(page);
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
  await expect(page.getByRole("heading", { name: "Recommended operator sequence" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "What is safe to do next" })).toBeVisible();
  await page.getByRole("button", { name: /Strategy/i }).click();
  await expect(page.getByRole("cell", { name: "baseline-trend" })).toBeVisible();

  await page.getByRole("button", { name: /Session/i }).click();
  await page.getByLabel("Session ID").fill("paper-alpha-live");
  await page.getByRole("button", { name: "Start" }).click();
  await expect(page.getByText("Session started", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Market/i }).click();
  await page.getByRole("button", { name: "Publish latest" }).click();
  await expect(page.getByText("Market publish completed", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: /Manual/i }).click();
  await page.getByRole("button", { name: "Send signal" }).click();
  await expect(page.getByText("Manual signal sent", { exact: true })).toBeVisible();
});

test("lab requires confirmation before reset and stop lifecycle actions", async ({
  page,
}) => {
  let resetRequests = 0;
  let stopRequests = 0;
  let currentSession = {
    id: "paper-live",
    last_event_at: "2026-04-18T09:05:00Z",
    reset_count: 0,
    started_at: "2026-04-18T09:00:00Z",
    status: "running",
  };

  await mockPlatformHealth(page);
  await mockJsonHandler(page, "**/core/api/paper/session", async (route) => {
    await fulfillJson(route, { session: currentSession });
  });
  await mockJson(page, "**/data/api/data/market/quotes/replay/scenarios", {
    scenarios: ["baseline"],
  });
  await mockJson(page, "**/data/api/data/strategy/signals/scenarios", {
    scenarios: ["baseline"],
  });
  await mockJson(page, "**/data/api/data/strategy/signals?*", {
    signals: [],
  });
  await mockJsonHandler(page, "**/core/api/paper/session/reset", async (route) => {
    resetRequests += 1;
    currentSession = {
      ...currentSession,
      last_event_at: "2026-04-18T09:10:00Z",
      reset_count: currentSession.reset_count + 1,
      status: "running",
    };
    await fulfillJson(route, { session: currentSession });
  });
  await mockJsonHandler(page, "**/core/api/paper/session/stop", async (route) => {
    stopRequests += 1;
    currentSession = {
      ...currentSession,
      last_event_at: "2026-04-18T09:15:00Z",
      status: "stopped",
    };
    await fulfillJson(route, { session: currentSession });
  });

  await page.goto("/lab");

  await expect(page.getByRole("heading", { name: "Current session control" })).toBeVisible();
  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm reset" })).toBeVisible();
  await expect(page.getByText("Confirm reset to clear")).toBeVisible();
  expect(resetRequests).toBe(0);
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(page.getByRole("button", { name: "Reset", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Reset", exact: true }).click();
  await page.getByRole("button", { name: "Confirm reset" }).click();
  await expect(page.getByText("Session reset", { exact: true })).toBeVisible();
  expect(resetRequests).toBe(1);

  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(page.getByRole("button", { name: "Confirm stop" })).toBeVisible();
  await expect(page.getByText("Confirm stop to close")).toBeVisible();
  expect(stopRequests).toBe(0);
  await page.getByRole("button", { name: "Confirm stop" }).click();
  await expect(page.getByText("Session stopped", { exact: true })).toBeVisible();
  expect(stopRequests).toBe(1);
});

test("lab shows actionable mutation errors without internal details", async ({
  page,
}) => {
  await mockPlatformHealth(page);
  await mockJson(page, "**/core/api/paper/session", {
    session: {
      id: "paper-live",
      last_event_at: "2026-04-18T09:05:00Z",
      reset_count: 0,
      started_at: "2026-04-18T09:00:00Z",
      status: "running",
    },
  });
  await mockJson(page, "**/data/api/data/market/quotes/replay/scenarios", {
    scenarios: ["baseline"],
  });
  await mockJson(page, "**/data/api/data/strategy/signals/scenarios", {
    scenarios: ["baseline"],
  });
  await mockJson(page, "**/data/api/data/strategy/signals?*", {
    signals: [],
  });
  await mockJsonHandler(page, "**/core/internal/signals", async (route) => {
    await fulfillJson(
      route,
      {
        error: {
          code: "internal_error",
          message: "panic: database password=secret",
        },
      },
      500,
    );
  });

  await page.goto("/lab");

  await page.getByRole("button", { name: /Manual/i }).click();
  await page.getByRole("button", { name: "Send signal" }).click();

  await expect(page.getByText("Manual signal failed", { exact: true })).toBeVisible();
  await expect(page.getByText("The service hit an internal error")).toBeVisible();
  await expect(page.getByText("database password=secret")).toHaveCount(0);
});

test("lab locks replay controls when the data upstream is down", async ({ page }) => {
  await mockPlatformHealth(page, { data: "down" });
  await mockJson(page, "**/core/api/paper/session", {
    session: {
      id: "paper-live",
      last_event_at: "2026-04-18T09:05:00Z",
      reset_count: 0,
      started_at: "2026-04-18T09:00:00Z",
      status: "running",
    },
  });
  await mockJsonHandler(page, "**/data/api/data/**", async (route) => {
    await fulfillJson(
      route,
      {
        error: {
          code: "upstream_unavailable",
          message: "Data Pipeline (Python) is unavailable.",
        },
      },
      503,
    );
  });

  await page.goto("/lab");

  await expect(page.getByText("Upstream availability degraded")).toBeVisible();
  await page.getByRole("button", { name: /Market/i }).click();
  await expect(page.getByRole("button", { name: "Publish latest" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Replay scenario" })).toBeDisabled();
  await page.getByRole("button", { name: /Strategy/i }).click();
  await expect(page.getByRole("button", { name: "Publish slice" })).toBeDisabled();
  await expect(page.getByRole("button", { name: "Replay all" })).toBeDisabled();
  await page.getByRole("button", { name: /Manual/i }).click();
  await expect(page.getByRole("button", { name: "Send signal" })).toBeEnabled();
});
