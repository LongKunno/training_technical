import type { SessionStatus, TimelineStreamStatus } from "../../shared/types";

const currencyFormatter = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 2,
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
});

const shortTimeFormatter = new Intl.DateTimeFormat("en-US", {
  hour: "2-digit",
  minute: "2-digit",
});

export function formatCurrency(value: number | null | undefined): string {
  return currencyFormatter.format(Number(value ?? 0));
}

export function formatSignedCurrency(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  const absoluteValue = currencyFormatter.format(Math.abs(amount));

  if (amount > 0) {
    return `+${absoluteValue}`;
  }

  if (amount < 0) {
    return `-${absoluteValue}`;
  }

  return absoluteValue;
}

export function formatCompactCurrency(value: number | null | undefined): string {
  const amount = Number(value ?? 0);
  const absoluteValue = Math.abs(amount);
  const sign = amount < 0 ? "-" : "";

  if (absoluteValue >= 1_000_000) {
    return `${sign}$${(absoluteValue / 1_000_000).toFixed(1)}M`;
  }

  if (absoluteValue >= 1_000) {
    return `${sign}$${(absoluteValue / 1_000).toFixed(1)}K`;
  }

  return formatCurrency(amount);
}

export function formatNumber(
  value: number | null | undefined,
  maximumFractionDigits = 4,
): string {
  return Number(value ?? 0).toLocaleString("en-US", {
    maximumFractionDigits,
    minimumFractionDigits: 0,
  });
}

export function formatPercentRatio(
  value: number | null | undefined,
  maximumFractionDigits = 2,
): string {
  return `${(Number(value ?? 0) * 100).toFixed(maximumFractionDigits)}%`;
}

export function formatDateTime(value?: string | null): string {
  if (!value) {
    return "-";
  }

  return dateTimeFormatter.format(new Date(value));
}

export function formatShortTime(value?: string | null): string {
  if (!value) {
    return "-";
  }

  return shortTimeFormatter.format(new Date(value));
}

export function formatDuration(seconds: number | null | undefined): string {
  const totalSeconds = Math.max(0, Number(seconds ?? 0));

  if (totalSeconds <= 0) {
    return "Off";
  }

  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }

  const minutes = Math.floor(totalSeconds / 60);
  const remainderSeconds = totalSeconds % 60;

  if (minutes < 60) {
    return remainderSeconds > 0 ? `${minutes}m ${remainderSeconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remainderMinutes = minutes % 60;
  return remainderMinutes > 0 ? `${hours}h ${remainderMinutes}m` : `${hours}h`;
}

export function formatGuardLimit(value: number | null | undefined): string {
  const limit = Number(value ?? 0);
  return limit > 0 ? formatCurrency(limit) : "Disabled";
}

export function getSessionStatusBadgeTone(
  status?: SessionStatus | null,
): "neutral" | "success" | "warning" {
  if (status === "running") {
    return "success";
  }

  if (status === "stopped") {
    return "warning";
  }

  return "neutral";
}

export function getStreamBadgeTone(
  status: TimelineStreamStatus,
): "neutral" | "success" | "warning" | "info" {
  switch (status) {
    case "open":
      return "success";
    case "connecting":
      return "info";
    case "degraded":
      return "warning";
    default:
      return "neutral";
  }
}

export function describeTimelineStreamStatus(status: TimelineStreamStatus): string {
  switch (status) {
    case "open":
      return "Live";
    case "connecting":
      return "Connecting";
    case "degraded":
      return "Reconnecting";
    default:
      return "Idle";
  }
}
