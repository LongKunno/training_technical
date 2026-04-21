import { describe, expect, it } from "vitest";

import { ApiClientError } from "../../shared/api/http";
import {
  formatRunStatus,
  formatSimulationSchedulerMessage,
  getRunStatusTone,
  isActiveRunStatus,
  toTimelineChartPoints,
} from "./formatters";

describe("runs formatters", () => {
  it("maps run statuses to badges and activity flags", () => {
    expect(formatRunStatus("starting")).toBe("Starting");
    expect(getRunStatusTone("running")).toBe("success");
    expect(getRunStatusTone("failed")).toBe("danger");
    expect(isActiveRunStatus("running")).toBe(true);
    expect(isActiveRunStatus("completed")).toBe(false);
  });

  it("converts timeline points into chart points", () => {
    const points = toTimelineChartPoints([
      {
        timestamp: "2026-04-20T10:00:00Z",
        equity: 10000,
        cash_balance: 9000,
        unrealized_pnl: 100,
        drawdown: 0,
        event_type: "session_started",
      },
      {
        timestamp: "2026-04-20T10:05:00Z",
        equity: 10150,
        cash_balance: 9100,
        unrealized_pnl: 150,
        drawdown: 0,
        event_type: "order_filled",
      },
    ]);

    expect(points).toHaveLength(2);
    expect(points[0]?.value).toBe(10000);
    expect(points[1]?.value).toBe(10150);
  });

  it("formats scheduler conflicts for single and batch workflows", () => {
    const busyError = new ApiClientError(409, "simulation_busy", "busy", {
      error: { code: "simulation_busy", message: "busy" },
    });
    const activeRunError = new ApiClientError(409, "run_already_active", "busy", {
      error: { code: "run_already_active", message: "busy" },
    });

    expect(formatSimulationSchedulerMessage(busyError, "run")).toContain("batch experiment");
    expect(formatSimulationSchedulerMessage(busyError, "experiment")).toContain("standalone run");
    expect(formatSimulationSchedulerMessage(activeRunError, "run")).toContain("standalone run is already active");
  });
});
