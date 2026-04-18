import { expect, test } from "@playwright/test";

import {
  fulfillJson,
  getEventSourceUrls,
  installEventSourceMock,
  mockJson,
  mockJsonHandler,
} from "./support";

const sessionHistory = [
  {
    filled_orders: 2,
    last_event_at: "2026-04-18T09:05:00Z",
    max_drawdown: 80,
    realized_pnl: 120,
    rejected_signals: 0,
    reset_count: 0,
    session_id: "paper-live",
    started_at: "2026-04-18T09:00:00Z",
    status: "running",
    total_pnl: 170,
  },
  {
    filled_orders: 1,
    last_event_at: "2026-04-17T12:05:00Z",
    max_drawdown: 120,
    realized_pnl: -20,
    rejected_signals: 1,
    reset_count: 1,
    session_id: "paper-historical",
    started_at: "2026-04-17T10:00:00Z",
    status: "stopped",
    total_pnl: -35,
  },
];

test("sessions route filters historical list without mounting SSE", async ({ page }) => {
  await installEventSourceMock(page);

  await mockJson(page, "**/core/api/paper/session", {
    session: {
      id: "paper-live",
      last_event_at: "2026-04-18T09:05:00Z",
      reset_count: 0,
      started_at: "2026-04-18T09:00:00Z",
      status: "running",
    },
  });
  await mockJsonHandler(page, "**/core/api/paper/sessions?*", async (route) => {
    const url = new URL(route.request().url());
    const q = url.searchParams.get("q") ?? "";
    const status = url.searchParams.get("status") ?? "";

    const sessions = sessionHistory.filter((session) => {
      const queryMatch = q ? session.session_id.includes(q) : true;
      const statusMatch = status ? session.status === status : true;
      return queryMatch && statusMatch;
    });

    await fulfillJson(route, { sessions });
  });
  await mockJsonHandler(page, "**/core/api/paper/report?*", async (route) => {
    const sessionId = new URL(route.request().url()).searchParams.get("session_id");
    await fulfillJson(route, {
      report: {
        fees_paid: sessionId === "paper-historical" ? 2 : 4.5,
        filled_orders: sessionId === "paper-historical" ? 1 : 2,
        max_drawdown: sessionId === "paper-historical" ? 120 : 80,
        realized_pnl: sessionId === "paper-historical" ? -20 : 120,
        rejected_signals: sessionId === "paper-historical" ? 1 : 0,
        reset_count: sessionId === "paper-historical" ? 1 : 0,
        session_id: sessionId ?? "paper-live",
        slippage_cost: 1.2,
        started_at:
          sessionId === "paper-historical"
            ? "2026-04-17T10:00:00Z"
            : "2026-04-18T09:00:00Z",
        status: sessionId === "paper-historical" ? "stopped" : "running",
        symbols: [],
        timeline: [],
        total_pnl: sessionId === "paper-historical" ? -35 : 170,
        unrealized_pnl: 0,
      },
    });
  });
  await mockJsonHandler(page, "**/core/api/paper/audit?*", async (route) => {
    const sessionId = new URL(route.request().url()).searchParams.get("session_id");
    await fulfillJson(route, {
      events: sessionId
        ? [
            {
              id: "evt-selected",
              message: `Loaded detail for ${sessionId}.`,
              session_id: sessionId,
              timestamp: "2026-04-18T09:05:00Z",
              type: "session_stopped",
            },
          ]
        : [],
    });
  });
  await mockJson(page, "**/core/api/paper/timeline?*", { timeline: [] });

  await page.goto("/sessions");

  await expect(page.getByRole("heading", { name: "Recent sessions" })).toBeVisible();
  await expect(page.getByRole("link", { name: "paper-live" })).toBeVisible();
  await expect(page.getByRole("link", { name: "paper-historical" })).toBeVisible();

  await page.getByLabel("Search session ID").fill("paper-historical");
  await page.getByRole("button", { name: "Apply query" }).click();

  await expect(page.getByRole("link", { name: "paper-historical" })).toBeVisible();
  await expect(page.getByRole("link", { name: "paper-live" })).toHaveCount(0);
  await expect(page).toHaveURL(/\/sessions\?q=paper-historical&selected=paper-historical$/);

  await page.getByRole("link", { name: "Open selected session" }).click();
  await expect(page).toHaveURL(
    /\/sessions\/paper-historical\?q=paper-historical&selected=paper-historical$/,
  );
  await expect(page.getByText("Loaded detail for paper-historical.")).toBeVisible();

  await page.getByRole("link", { name: "Back to sessions" }).click();
  await expect(page).toHaveURL(/\/sessions\?q=paper-historical&selected=paper-historical$/);
  await expect(page.getByRole("link", { name: "paper-historical" })).toBeVisible();
  await expect
    .poll(async () => getEventSourceUrls(page))
    .toEqual([]);
});

test("session detail stays historical and never mounts current-session SSE", async ({ page }) => {
  await installEventSourceMock(page);

  await mockJson(page, "**/core/api/paper/report?session_id=paper-historical", {
    report: {
      fees_paid: 2.5,
      filled_orders: 1,
      max_drawdown: 120,
      realized_pnl: -20,
      rejected_signals: 1,
      reset_count: 1,
      session_id: "paper-historical",
      slippage_cost: 0.5,
      started_at: "2026-04-17T10:00:00Z",
      status: "stopped",
      symbols: [],
      timeline: [],
      total_pnl: -35,
      unrealized_pnl: 0,
    },
  });
  await mockJson(page, "**/core/api/paper/audit?session_id=paper-historical*", {
    events: [
      {
        id: "evt-1",
        message: "Historical replay completed.",
        session_id: "paper-historical",
        timestamp: "2026-04-17T12:05:00Z",
        type: "session_stopped",
      },
    ],
  });
  await mockJson(page, "**/core/api/paper/timeline?session_id=paper-historical*", { timeline: [] });

  await page.goto("/sessions/paper-historical");

  await expect(
    page.getByRole("heading", { name: "Historical detail for paper-historical" }),
  ).toBeVisible();
  await expect(page.getByText("No SSE")).toBeVisible();
  await expect(page.getByText("Historical replay completed.")).toBeVisible();
  await expect(page.getByText("No timeline stored for this session")).toBeVisible();
  await expect
    .poll(async () => getEventSourceUrls(page))
    .toEqual([]);
});
