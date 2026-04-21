import { ApiClientError } from "../../shared/api/http";
import type { ExperimentStatus, RunStatus, SessionTimelinePoint } from "../../shared/types";

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const integerFormatter = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0,
});

const currencyFormatter = new Intl.NumberFormat("en-US", {
  currency: "USD",
  maximumFractionDigits: 2,
  style: "currency",
});

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

export function formatDateTime(value?: string | null) {
  if (!value) {
    return "-";
  }

  return dateTimeFormatter.format(new Date(value));
}

export function formatInteger(value: number) {
  return integerFormatter.format(value);
}

export function formatCurrency(value?: number | null) {
  return currencyFormatter.format(value ?? 0);
}

export function formatSignedCurrency(value?: number | null) {
  const safeValue = value ?? 0;
  return `${safeValue > 0 ? "+" : safeValue < 0 ? "-" : ""}${currencyFormatter.format(Math.abs(safeValue))}`;
}

export function formatRunStatus(status: RunStatus | ExperimentStatus) {
  switch (status) {
    case "queued":
      return "Queued";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "completed":
      return "Completed";
    case "stopped":
      return "Stopped";
    case "failed":
      return "Failed";
    default:
      return status;
  }
}

export function getRunStatusTone(status: RunStatus | ExperimentStatus): BadgeTone {
  switch (status) {
    case "running":
      return "success";
    case "queued":
    case "starting":
      return "info";
    case "completed":
      return "neutral";
    case "stopped":
      return "warning";
    case "failed":
      return "danger";
    default:
      return "neutral";
  }
}

export function isActiveRunStatus(status: RunStatus) {
  return status === "starting" || status === "running";
}

export function toTimelineChartPoints(timeline: SessionTimelinePoint[]) {
  return timeline.map((point) => ({
    label: new Date(point.timestamp).toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
    }),
    value: point.equity,
  }));
}

export function formatSimulationSchedulerMessage(error: unknown, workflow: "run" | "experiment") {
  if (error instanceof ApiClientError) {
    if (error.code === "simulation_busy") {
      if (workflow === "run") {
        return "Scheduler conflict: a batch experiment already owns the singleton engine. Wait for it to finish or stop it before starting a standalone run.";
      }
      return "Scheduler conflict: an active standalone run or experiment already owns the singleton engine. Wait for it to finish or stop it before starting a batch.";
    }

    if (error.code === "run_already_active") {
      return "A standalone run is already active. Stop it or wait for it to finish before starting another single run.";
    }
  }

  return error instanceof Error ? error.message : "Request failed.";
}
