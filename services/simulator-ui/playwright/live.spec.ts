import { randomUUID } from "node:crypto";

import {
  expect,
  test,
  type APIRequestContext,
  type APIResponse,
} from "@playwright/test";

const RUN_TERMINAL_TIMEOUT_MS = 30_000;
const EXPERIMENT_TERMINAL_TIMEOUT_MS = 45_000;

async function expectJson(
  response: APIResponse,
  expectedStatus: number,
): Promise<Record<string, unknown>> {
  expect(response.status(), await response.text()).toBe(expectedStatus);
  return (await response.json()) as Record<string, unknown>;
}

async function startSession(request: APIRequestContext, sessionId: string) {
  const payload = await expectJson(
    await request.post("/core/api/paper/session/start", {
      data: { session_id: sessionId },
    }),
    201,
  );

  expect(payload.session).toMatchObject({
    id: sessionId,
    status: "running",
  });
}

async function waitForProxyReadiness(request: APIRequestContext) {
  await expect
    .poll(async () => {
      const [coreResponse, dataResponse] = await Promise.all([
        request.get("/core/health"),
        request.get("/data/health"),
      ]);
      return {
        core: coreResponse.status(),
        data: dataResponse.status(),
      };
    })
    .toEqual({
      core: 200,
      data: 200,
    });
}

async function publishBaselineMarket(request: APIRequestContext) {
  const payload = await expectJson(
    await request.post("/data/api/data/market/quotes/publish", {
      data: {
        scenario: "baseline",
        transport: "http",
      },
    }),
    200,
  );

  expect(payload).toMatchObject({
    published_count: 2,
    scenario: "baseline",
    transport: "http",
  });
}

async function sendManualSignal(request: APIRequestContext, sessionId: string) {
  const signalId = `playwright-${sessionId}-${randomUUID().slice(0, 8)}`;

  const payload = await expectJson(
    await request.post("/core/internal/signals", {
      data: {
        notional: 100,
        price_hint: 0,
        side: "buy",
        signal_id: signalId,
        strategy_id: "playwright-live",
        symbol: "BTCUSDT",
        timestamp: new Date().toISOString(),
      },
    }),
    201,
  );

  expect(payload.execution).toMatchObject({
    signal_id: signalId,
    status: "accepted",
    strategy_id: "playwright-live",
  });
}

async function stopSessionIfRunning(request: APIRequestContext) {
  const response = await request.post("/core/api/paper/session/stop", {
    data: {},
  });

  if (response.status() === 200) {
    return;
  }

  if (response.status() === 409) {
    const payload = (await response.json()) as Record<string, unknown>;
    expect(payload.error).toMatchObject({
      code: "session_stopped",
    });
    return;
  }

  expect(response.status(), await response.text()).toBe(200);
}

async function createSimulationRun(
  request: APIRequestContext,
  payload: Record<string, unknown>,
) {
  const response = await expectJson(
    await request.post("/core/api/sim/runs", {
      data: payload,
    }),
    201,
  );

  expect(response.run).toMatchObject({
    run_id: expect.any(String),
    status: "running",
  });
  return response.run as {
    run_id: string;
    session_id: string;
    status: string;
  };
}

async function waitForRunTerminal(request: APIRequestContext, runId: string) {
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/core/api/sim/runs/${encodeURIComponent(runId)}`,
        );
        if (!response.ok()) {
          return null;
        }
        const payload = (await response.json()) as {
          run?: { status?: string };
        };
        return payload.run?.status ?? null;
      },
      {
        timeout: RUN_TERMINAL_TIMEOUT_MS,
      },
    )
    .toBe("completed");

  const payload = await expectJson(
    await request.get(`/core/api/sim/runs/${encodeURIComponent(runId)}`),
    200,
  );
  return payload.run as {
    experiment_id?: string;
    run_id: string;
    session_id: string;
    status: string;
  };
}

async function createExperiment(
  request: APIRequestContext,
  payload: Record<string, unknown>,
) {
  const response = await expectJson(
    await request.post("/core/api/sim/experiments", {
      data: payload,
    }),
    201,
  );

  expect(response.experiment).toMatchObject({
    experiment_id: expect.any(String),
    planned_runs: expect.any(Number),
  });
  return response.experiment as {
    experiment_id: string;
    planned_runs: number;
    status: string;
  };
}

async function waitForExperimentTerminal(
  request: APIRequestContext,
  experimentId: string,
) {
  await expect
    .poll(
      async () => {
        const response = await request.get(
          `/core/api/sim/experiments/${encodeURIComponent(experimentId)}`,
        );
        if (!response.ok()) {
          return null;
        }
        const payload = (await response.json()) as {
          experiment?: { status?: string };
        };
        return payload.experiment?.status ?? null;
      },
      {
        timeout: EXPERIMENT_TERMINAL_TIMEOUT_MS,
      },
    )
    .toBe("completed");

  const payload = await expectJson(
    await request.get(
      `/core/api/sim/experiments/${encodeURIComponent(experimentId)}`,
    ),
    200,
  );
  return payload.experiment as {
    active_run_id?: string;
    completed_runs: number;
    experiment_id: string;
    planned_runs: number;
    runs?: Array<{ run_id: string }>;
    status: string;
  };
}

async function waitForSessionHistory(
  request: APIRequestContext,
  sessionId: string,
  status: string,
) {
  await expect
    .poll(async () => {
      const response = await request.get(
        `/core/api/paper/sessions?q=${encodeURIComponent(sessionId)}&limit=20&offset=0`,
      );
      if (!response.ok()) {
        return null;
      }

      const payload = (await response.json()) as {
        sessions?: Array<{ session_id: string; status: string }>;
      };
      return (
        payload.sessions?.find((session) => session.session_id === sessionId)
          ?.status ?? null
      );
    })
    .toBe(status);
}

async function seedSession(
  request: APIRequestContext,
  sessionId: string,
  stopAfterSeed = false,
) {
  await waitForProxyReadiness(request);
  await startSession(request, sessionId);
  await publishBaselineMarket(request);
  await sendManualSignal(request, sessionId);

  if (stopAfterSeed) {
    await expectJson(
      await request.post("/core/api/paper/session/stop", { data: {} }),
      200,
    );
    await waitForSessionHistory(request, sessionId, "stopped");
    return;
  }

  await waitForSessionHistory(request, sessionId, "running");
}

test.afterEach(async ({ request }) => {
  await stopSessionIfRunning(request);
});

test("dashboard renders current-session data from the real stack", async ({
  page,
  request,
}) => {
  const sessionId = `playwright-live-${randomUUID().slice(0, 8)}`;
  await seedSession(request, sessionId);

  await page.goto("/dashboard");

  await expect(
    page.getByRole("heading", { name: "Current-session live monitor" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Control room" }),
  ).toBeVisible();
  await expect(
    page.getByText(sessionId, { exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Open positions" }),
  ).toBeVisible();
  await expect(
    page
      .getByRole("table", { name: "Current positions" })
      .getByRole("cell", { name: "BTCUSDT" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "View alerts" }).click();
  await expect(page.getByText("Recent order flow available")).toBeVisible();
});

test("sessions route opens immutable historical detail from the real stack", async ({
  page,
  request,
}) => {
  const sessionId = `playwright-history-${randomUUID().slice(0, 8)}`;
  await seedSession(request, sessionId, true);

  await page.goto(
    `/sessions?q=${encodeURIComponent(sessionId)}&selected=${encodeURIComponent(sessionId)}`,
  );

  await expect(
    page.getByRole("heading", { name: "Recent sessions" }),
  ).toBeVisible();
  await expect(page.getByRole("link", { name: sessionId })).toBeVisible();
  await page.getByRole("link", { name: "Open selected session" }).click();

  await expect(
    page.getByRole("heading", { name: `Historical detail for ${sessionId}` }),
  ).toBeVisible();
  await expect(page.getByText("No SSE").first()).toBeVisible();
  await expect(
    page.getByText("Historical detail is intentionally isolated"),
  ).toBeVisible();
});

test("historical detail stays immutable while the current session keeps streaming", async ({
  page,
  request,
}) => {
  const historicalSessionId = `playwright-history-${randomUUID().slice(0, 8)}`;
  const currentSessionId = `playwright-current-${randomUUID().slice(0, 8)}`;

  await seedSession(request, historicalSessionId, true);
  await seedSession(request, currentSessionId);

  await page.goto(`/sessions/${encodeURIComponent(historicalSessionId)}`);

  await expect(
    page.getByRole("heading", {
      name: `Historical detail for ${historicalSessionId}`,
    }),
  ).toBeVisible();
  await expect(page.getByText("No SSE").first()).toBeVisible();

  const timelineSummary = page.getByText(/\d+ timeline points/).first();
  const initialTimelineSummary = (await timelineSummary.textContent())?.trim();
  expect(initialTimelineSummary).toBeTruthy();

  await publishBaselineMarket(request);
  await sendManualSignal(request, currentSessionId);
  await page.waitForTimeout(1500);

  await expect(
    page.getByRole("heading", {
      name: `Historical detail for ${historicalSessionId}`,
    }),
  ).toBeVisible();
  await expect(timelineSummary).toHaveText(initialTimelineSummary as string);
  await expect(
    page.getByRole("button", { name: "Refresh detail" }),
  ).toBeVisible();
});

test("lab route runs real operator actions and records activity", async ({
  page,
  request,
}) => {
  await waitForProxyReadiness(request);
  const sessionId = `playwright-lab-${randomUUID().slice(0, 8)}`;

  await page.goto("/lab");

  await expect(
    page.getByRole("heading", { name: "Current session control" }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Operator activity feed" }),
  ).toBeVisible();
  await page.getByRole("button", { name: /Strategy/i }).click();
  await expect(
    page.getByRole("cell", { name: "baseline-trend" }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Session/i }).click();
  await page.getByLabel("Session ID").fill(sessionId);
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await expect(
    page.getByText("Session started", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Market/i }).click();
  await page.getByRole("button", { name: "Publish latest" }).click();
  await expect(
    page.getByText("Market publish completed", { exact: true }),
  ).toBeVisible();

  await page.getByRole("button", { name: /Manual/i }).click();
  await page.getByRole("button", { name: "Send signal" }).click();
  await expect(
    page.getByText("Manual signal sent", { exact: true }),
  ).toBeVisible();
});

test("experiments workflow completes on the real stack and stays out of the global leaderboard", async ({
  page,
  request,
}) => {
  await waitForProxyReadiness(request);

  const standaloneRun = await createSimulationRun(request, {
    bot_id: "baseline-roundtrip",
    scenario_id: "baseline",
  });
  const completedStandaloneRun = await waitForRunTerminal(
    request,
    standaloneRun.run_id,
  );

  const experiment = await createExperiment(request, {
    name: `playwright-batch-${randomUUID().slice(0, 8)}`,
    bots: [{ bot_id: "buy-and-hold", bot_version: "v1" }],
    scenarios: ["trend-up"],
    repetitions: 1,
  });
  const completedExperiment = await waitForExperimentTerminal(
    request,
    experiment.experiment_id,
  );

  expect(completedExperiment.status).toBe("completed");
  expect(completedExperiment.planned_runs).toBe(1);
  expect(completedExperiment.completed_runs).toBe(1);
  expect(completedExperiment.runs?.length).toBe(1);

  const summaryPayload = await expectJson(
    await request.get(
      `/core/api/sim/experiments/${encodeURIComponent(experiment.experiment_id)}/summary`,
    ),
    200,
  );
  expect(summaryPayload.rows).toMatchObject([
    {
      bot_id: "buy-and-hold",
      bot_version: "v1",
      completed_runs: 1,
      scenario_id: "trend-up",
      scheduled_runs: 1,
    },
  ]);

  const childRunsPayload = await expectJson(
    await request.get(
      `/core/api/sim/runs?experiment_id=${encodeURIComponent(experiment.experiment_id)}&limit=10&offset=0`,
    ),
    200,
  );
  const childRuns = childRunsPayload.runs as Array<{
    experiment_id?: string;
    run_id: string;
  }>;
  expect(childRuns).toHaveLength(1);
  expect(childRuns[0]?.experiment_id).toBe(experiment.experiment_id);

  const childRunId = childRuns[0]?.run_id as string;
  const childRunPayload = await expectJson(
    await request.get(`/core/api/sim/runs/${encodeURIComponent(childRunId)}`),
    200,
  );
  expect(childRunPayload.run).toMatchObject({
    experiment_id: experiment.experiment_id,
    run_id: childRunId,
    status: "completed",
  });

  const childSessionId = (childRunPayload.run as { session_id: string })
    .session_id;
  await expectJson(
    await request.get(
      `/core/api/paper/report?session_id=${encodeURIComponent(childSessionId)}`,
    ),
    200,
  );
  await expectJson(
    await request.get(
      `/core/api/paper/audit?session_id=${encodeURIComponent(childSessionId)}&limit=50&offset=0`,
    ),
    200,
  );
  await expectJson(
    await request.get(
      `/core/api/paper/timeline?session_id=${encodeURIComponent(childSessionId)}`,
    ),
    200,
  );

  await page.goto(
    `/experiments/${encodeURIComponent(experiment.experiment_id)}`,
  );
  await expect(
    page.getByRole("heading", { name: /playwright-batch-/i }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Experiment summary" }),
  ).toContainText("buy-and-hold");
  await expect(page.getByRole("link", { name: childRunId })).toBeVisible();

  await page.getByRole("link", { name: childRunId }).click();
  await expect(page).toHaveURL(new RegExp(`/runs/${childRunId}$`));
  await expect(
    page.getByRole("button", { name: "Open experiment" }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Open experiment" }).click();
  await expect(page).toHaveURL(
    new RegExp(`/experiments/${experiment.experiment_id}$`),
  );

  await page.goto("/leaderboard");
  await expect(
    page.getByRole("heading", { name: "Standalone run leaderboard" }),
  ).toBeVisible();
  await expect(
    page.getByRole("table", { name: "Simulation leaderboard" }),
  ).toContainText(completedStandaloneRun.run_id);
  await expect(
    page.getByRole("table", { name: "Simulation leaderboard" }),
  ).not.toContainText(childRunId);
});
