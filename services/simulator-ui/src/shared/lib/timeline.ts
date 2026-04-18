import type { SessionReport, SessionTimelinePoint } from "../types";

function getPointIdentity(point: SessionTimelinePoint): string {
  return [
    point.timestamp,
    point.event_type,
    point.equity,
    point.cash_balance,
    point.unrealized_pnl,
    point.drawdown,
  ].join("|");
}

export function normalizeTimeline(points: SessionTimelinePoint[] = []): SessionTimelinePoint[] {
  return [...points].sort((left, right) => {
    return new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime();
  });
}

export function appendTimelinePoint(
  points: SessionTimelinePoint[] = [],
  point: SessionTimelinePoint,
): SessionTimelinePoint[] {
  const pointIdentity = getPointIdentity(point);

  if (points.some((existingPoint) => getPointIdentity(existingPoint) === pointIdentity)) {
    return normalizeTimeline(points);
  }

  return normalizeTimeline([...points, point]);
}

export function getReportTimeline(
  report?: Pick<SessionReport, "timeline"> | null,
  fallback: SessionTimelinePoint[] = [],
): SessionTimelinePoint[] {
  const source = report?.timeline ?? fallback;
  return normalizeTimeline(source);
}

export function attachTimelineToReport(
  report: SessionReport,
  timeline: SessionTimelinePoint[],
): SessionReport {
  return {
    ...report,
    timeline: normalizeTimeline(timeline),
  };
}

