import { Link } from "react-router-dom";

import { ApiClientError, formatOperatorErrorMessage } from "../../shared/api";
import {
  ChartPanel,
  createHorizontalBarOption,
} from "../../shared/charts";
import {
  resolveServiceAvailability,
  useCoreHealthQuery,
  useCurrentSessionSnapshotQuery,
  useSessionHistoryQuery,
  useCurrentTimelineStream,
} from "../../shared/query";
import { selectTimelineStreamStatus, useOperatorUiStore } from "../../shared/state";
import type {
  CurrentSessionSnapshot,
  PaperOrder,
  PortfolioPositionSummary,
  SessionHistoryEntry,
  TimelineStreamStatus,
  UpstreamAvailability,
} from "../../shared/types";
import {
  Badge,
  DataTable,
  DisclosurePanel,
  EmptyState,
  InfoTooltip,
  PageHeader,
  Panel,
  ProgressBar,
  PulseIcon,
  SummaryStrip,
  cx,
} from "../../shared/ui";
import { createCurrentTimelineOption } from "./dashboard-chart";
import {
  describeTimelineStreamStatus,
  formatCurrency,
  formatDateTime,
  formatDuration,
  formatGuardLimit,
  formatNumber,
  formatPercentRatio,
  formatShortTime,
  formatSignedCurrency,
  getSessionStatusBadgeTone,
  getStreamBadgeTone,
} from "./dashboard-formatters";

interface MetricItem {
  label: string;
  value: string;
  hint?: string;
  valueClassName?: string;
}

interface EmptyCopy {
  title: string;
  description: string;
}

interface RiskPosture {
  label: string;
  tone: "success" | "warning" | "accent";
  detail: string;
  trend: string;
}

interface AttentionItem {
  title: string;
  detail: string;
  tone: "success" | "warning" | "danger" | "info";
}

type BadgeTone = "neutral" | "success" | "warning" | "danger" | "info";

type DashboardViewMode =
  | "live"
  | "stopped_snapshot"
  | "no_session"
  | "backend_down";

const actionLinkClassName =
  "focus-ring inline-flex h-11 items-center justify-center rounded-[18px] border px-5 text-sm font-medium transition";

function resolveDashboardViewMode(
  snapshot: CurrentSessionSnapshot | undefined,
  error: unknown,
  coreAvailability: UpstreamAvailability,
): DashboardViewMode {
  if (snapshot?.session.status === "running") {
    return "live";
  }

  if (snapshot?.session.status === "stopped") {
    return "stopped_snapshot";
  }

  if (coreAvailability === "down") {
    return "backend_down";
  }

  if (error instanceof ApiClientError && error.code === "session_not_found") {
    return "no_session";
  }

  return error ? "backend_down" : "live";
}

function getDashboardModeLabel(
  mode: DashboardViewMode,
  isInitialLoading: boolean,
): string {
  if (isInitialLoading) {
    return "Loading snapshot";
  }

  switch (mode) {
    case "live":
      return "Live";
    case "stopped_snapshot":
      return "Stopped snapshot";
    case "no_session":
      return "No live session";
    default:
      return "Backend down";
  }
}

function formatOrderStatusLabel(status: string | undefined): string {
  return status?.replace(/_/g, " ") || "unknown";
}

function getOrderStatusBadgeTone(status: string | undefined): BadgeTone {
  switch (status) {
    case "filled":
      return "success";
    case "partially_filled":
      return "warning";
    case "stopped":
      return "warning";
    case "rejected":
      return "danger";
    default:
      return "neutral";
  }
}

function getOrderFillCount(order: PaperOrder): number {
  if (typeof order.fill_count === "number") {
    return order.fill_count;
  }

  return order.quantity > 0 ? 1 : 0;
}

function getOrderRemainingQuantity(order: PaperOrder): number {
  if (typeof order.remaining_quantity === "number") {
    return order.remaining_quantity;
  }

  return Math.max(0, (order.requested_quantity ?? order.quantity) - order.quantity);
}

function getOrderRequestedQuantity(order: PaperOrder): number {
  return order.requested_quantity ?? order.quantity + getOrderRemainingQuantity(order);
}

function getPageHeaderTone(
  mode: DashboardViewMode,
  isInitialLoading: boolean,
): "accent" | "default" | "soft" | "warning" {
  if (isInitialLoading) {
    return "default";
  }

  switch (mode) {
    case "live":
      return "accent";
    case "backend_down":
      return "warning";
    case "stopped_snapshot":
    case "no_session":
      return "soft";
    default:
      return "default";
  }
}

function getMostRecentHistoricalSession(
  sessions: SessionHistoryEntry[] | undefined,
): SessionHistoryEntry | null {
  if (!sessions?.length) {
    return null;
  }

  return [...sessions].sort(
    (left, right) =>
      new Date(right.last_event_at).getTime() - new Date(left.last_event_at).getTime(),
  )[0] ?? null;
}

function getDashboardEmptyCopy(
  mode: DashboardViewMode,
  error: unknown,
  coreAvailability: UpstreamAvailability,
  isInitialLoading: boolean,
): EmptyCopy {
  if (isInitialLoading) {
    return {
      title: "Loading current-session snapshot",
      description: "Dashboard đang nạp current session snapshot và sẽ bật realtime stream khi session đang chạy.",
    };
  }

  if (coreAvailability === "down" || mode === "backend_down") {
    return {
      title: "Core trading API unavailable",
      description: "Dashboard chưa đọc được snapshot paper hiện tại vì Core Trading đang không phản hồi.",
    };
  }

  if (mode === "no_session" || (error instanceof ApiClientError && error.code === "session_not_found")) {
    return {
      title: "No active live session",
      description: "Dashboard đang idle vì hiện chưa có current session. Vào Lab để start session mới hoặc mở Sessions để xem lịch sử đã lưu.",
    };
  }

  if (mode === "stopped_snapshot") {
    return {
      title: "Stopped snapshot only",
      description: "Session hiện tại đã dừng. Dashboard đang hiển thị snapshot cuối cùng đã được persist, không còn stream live.",
    };
  }

  if (error instanceof Error) {
    return {
      title: "Current session snapshot unavailable",
      description: formatOperatorErrorMessage(error),
    };
  }

  return {
    title: "Current session snapshot unavailable",
    description: "Dashboard chưa tải được snapshot live của session hiện tại.",
  };
}

function getOpenExposure(positions: PortfolioPositionSummary[]): number {
  return positions.reduce((total, position) => total + Math.abs(Number(position.market_value ?? 0)), 0);
}

function getRiskPosture(snapshot?: CurrentSessionSnapshot): RiskPosture {
  if (!snapshot) {
    return {
      label: "Waiting",
      tone: "accent",
      detail: "Trạng thái risk sẽ rõ khi snapshot hiện tại được nạp xong.",
      trend: "snapshot pending",
    };
  }

  const openExposure = getOpenExposure(snapshot.positions);
  const maxDailyLoss = Number(snapshot.rules.risk_controls.max_daily_loss ?? 0);
  const maxOpenNotional = Number(snapshot.rules.risk_controls.max_open_notional ?? 0);
  const consumedLoss = Math.max(-Number(snapshot.report.total_pnl ?? 0), 0);
  const lossUtilization = maxDailyLoss > 0 ? consumedLoss / maxDailyLoss : 0;
  const exposureUtilization = maxOpenNotional > 0 ? openExposure / maxOpenNotional : 0;
  const highestUtilization = Math.max(lossUtilization, exposureUtilization);

  if (highestUtilization >= 0.85 || snapshot.report.rejected_signals > 0) {
    return {
      label: "Guarded",
      tone: "warning",
      detail: "Một hoặc nhiều guardrail đang tiến sát ngưỡng cấu hình.",
      trend: `${Math.round(highestUtilization * 100)}% guard usage`,
    };
  }

  if (highestUtilization >= 0.55) {
    return {
      label: "Watch",
      tone: "accent",
      detail: "Exposure vẫn ổn nhưng đã rời khỏi vùng sử dụng thấp.",
      trend: `${Math.round(highestUtilization * 100)}% guard usage`,
    };
  }

  return {
    label: "Healthy",
    tone: "success",
    detail: "Daily loss và open notional vẫn nằm an toàn trong giới hạn.",
    trend: "buffer available",
  };
}

function renderMetricCard(item: MetricItem) {
  return (
    <div
      key={item.label}
      className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4 shadow-[inset_0_1px_0_rgba(255,255,255,0.02)]"
    >
      <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">{item.label}</div>
      <div className={cx("mt-2 text-xl font-medium text-white", item.valueClassName)}>{item.value}</div>
      {item.hint ? <div className="mt-2 text-sm leading-6 text-slate-400">{item.hint}</div> : null}
    </div>
  );
}

function buildOperatorSnapshotSummary(
  mode: DashboardViewMode,
  snapshot: CurrentSessionSnapshot | undefined,
  latestHistoricalSession: SessionHistoryEntry | null,
  riskPosture: RiskPosture,
  currentErrorCopy: EmptyCopy,
  isInitialLoading: boolean,
) {
  if (isInitialLoading) {
    return {
      currentFocus: "Dashboard đang nạp snapshot hiện tại.",
      nextMove: "Chờ current-session query hoàn tất. Nếu session đang chạy, SSE sẽ tự gắn vào route này.",
      mode: "Loading snapshot",
    };
  }

  if (mode === "backend_down") {
    return {
      currentFocus: "Core Trading đang không phản hồi nên dashboard chưa đọc được current session.",
      nextMove: "Khôi phục /core/health rồi refresh. Nếu cần đọc dữ liệu cũ đã lưu, chuyển sang Sessions.",
      mode: "Backend down",
    };
  }

  if (mode === "no_session") {
    return {
      currentFocus: "Hiện chưa có current session nào để stream realtime.",
      nextMove: latestHistoricalSession
        ? `Mở Sessions để review ${latestHistoricalSession.session_id}, hoặc vào Lab để start session mới.`
        : "Vào Lab để start session mới rồi quay lại đây để theo dõi realtime.",
      mode: "Idle / no live session",
    };
  }

  if (mode === "stopped_snapshot") {
    return {
      currentFocus: "Dashboard đang giữ snapshot cuối của một session đã dừng.",
      nextMove: "Mở Sessions để xem immutable history hoặc vào Lab để reset hay start session mới.",
      mode: "Stopped snapshot",
    };
  }

  if (!snapshot) {
    return {
      currentFocus: currentErrorCopy.title,
      nextMove: "Mở Lab rồi start hoặc reset session trước khi chờ metric live ở đây.",
      mode: "Snapshot unavailable",
    };
  }

  if (snapshot.positions.length === 0 && snapshot.orders.length === 0) {
    return {
      currentFocus: "Session đã chạy nhưng order flow vẫn còn yên.",
      nextMove: "Dùng Lab để publish market hoặc strategy event, rồi quay lại theo dõi fill và exposure.",
      mode: "Live / waiting for first flow",
    };
  }

  if (riskPosture.tone === "warning") {
    return {
      currentFocus: "Guardrail đang tiến sát ngưỡng cấu hình.",
      nextMove: "Ưu tiên kiểm tra mức dùng risk budget và các fill gần nhất. Nếu exposure còn tăng, quay sang Lab để can thiệp.",
      mode: "Live / risk first",
    };
  }

  return {
    currentFocus: "Live session đang chạy ổn và guardrail vẫn trong ngân sách.",
    nextMove: "Ở lại dashboard để quan sát realtime. Chỉ mở Sessions khi cần xem lịch sử immutable.",
    mode: "Live / balanced monitoring",
  };
}

function buildAttentionItems(
  mode: DashboardViewMode,
  snapshot: CurrentSessionSnapshot | undefined,
  latestHistoricalSession: SessionHistoryEntry | null,
  coreAvailability: UpstreamAvailability,
  riskPosture: RiskPosture,
  timelineStreamStatus: TimelineStreamStatus,
  isInitialLoading: boolean,
  streamError?: Error,
): AttentionItem[] {
  if (isInitialLoading) {
    return [
      {
        title: "Loading snapshot",
        detail: "Current-session snapshot đang được nạp. Route này sẽ chỉ mở SSE nếu session hiện tại thực sự đang running.",
        tone: "info",
      },
    ];
  }

  if (mode === "backend_down" || (!snapshot && coreAvailability === "down")) {
    return [
      {
        title: "Core trading API is down",
        detail: "Các đọc current-session phụ thuộc vào /core/* nên dashboard chưa thể hydrate cho tới khi paper engine hoạt động lại.",
        tone: "danger",
      },
    ];
  }

  if (mode === "no_session") {
    return [
      {
        title: "Dashboard is idle",
        detail: "Hiện chưa có current session nên route này không mount SSE và không có live snapshot để mutate.",
        tone: "warning",
      },
      latestHistoricalSession
        ? {
            title: "Latest stored session ready",
            detail: `Session gần nhất là ${latestHistoricalSession.session_id}, updated ${formatDateTime(latestHistoricalSession.last_event_at)}, PnL ${formatSignedCurrency(latestHistoricalSession.total_pnl)}.`,
            tone: "info",
          }
        : {
            title: "No stored session yet",
            detail: "Chưa có session lịch sử để review. Hãy start một session mới từ Lab để tạo dữ liệu cho dashboard và Sessions.",
            tone: "info",
          },
    ];
  }

  if (mode === "stopped_snapshot" && snapshot) {
    const items: AttentionItem[] = [
      {
        title: "Stopped snapshot",
        detail: `Session ${snapshot.session.id} đã dừng. Dashboard giữ snapshot cuối cùng đã persist nên các metric phía dưới chỉ còn là last known state.`,
        tone: "warning",
      },
      {
        title: "SSE intentionally idle",
        detail: "Current-session stream chỉ mount khi status là running. Khi session đã stopped, route này sẽ giữ stream ở trạng thái idle.",
        tone: "info",
      },
    ];

    if (snapshot.orders.length > 0) {
      items.push({
        title: "Historical detail is worth reviewing",
        detail: `Snapshot cuối vẫn có ${formatNumber(snapshot.orders.length, 0)} fill gần nhất. Mở Sessions để đọc report, audit và timeline immutable.`,
        tone: "info",
      });
    }

    return items;
  }

  if (!snapshot) {
    return [
      {
        title: "Current snapshot missing",
        detail: "Hiện chưa có snapshot cho session hiện tại. Hãy start hoặc reset session từ Lab.",
        tone: "warning",
      },
    ];
  }

  const items: AttentionItem[] = [];

  if (streamError || timelineStreamStatus === "degraded") {
    items.push({
      title: "Live stream degraded",
      detail: streamError?.message ?? "Kết nối SSE của current session đang không ổn định. Theo dõi badge trạng thái và số lần reconnect.",
      tone: "danger",
    });
  } else {
    items.push({
      title: "Live stream healthy",
      detail: "SSE của current session đang kết nối tốt và chỉ mutate route này.",
      tone: "success",
    });
  }

  if (riskPosture.tone === "warning") {
    items.push({
      title: "Guardrails need attention",
      detail: `${riskPosture.detail} ${riskPosture.trend}. Nên xem lại exposure và loss usage trước khi bơm thêm flow.`,
      tone: "warning",
    });
  } else if (riskPosture.tone === "accent") {
    items.push({
      title: "Exposure leaving the low-utilization zone",
      detail: `${riskPosture.detail} Từ mốc này nên nhìn drawdown và fill cùng lúc để tránh bị trễ phản ứng.`,
      tone: "info",
    });
  } else {
    items.push({
      title: "Guardrails still inside budget",
      detail: "Loss và exposure vẫn còn cách khá xa các ngưỡng cấu hình.",
      tone: "success",
    });
  }

  if (snapshot.orders.length === 0) {
    items.push({
      title: "No recent order flow",
      detail: "Paper engine đã live nhưng chưa thấy fill nào trong session hiện tại. Hãy publish market hoặc strategy event từ Lab.",
      tone: "info",
    });
  } else {
    items.push({
      title: "Recent order flow available",
      detail: `Đã có ${formatNumber(snapshot.orders.length, 0)} fill gần nhất ngay trên dashboard để xem execution drag và exposure nhanh hơn.`,
      tone: "info",
    });
  }

  return items;
}

function MetricGrid({
  items,
  columns = 2,
}: {
  items: MetricItem[];
  columns?: 1 | 2 | 3;
}) {
  const gridClassName =
    columns === 3 ? "xl:grid-cols-3" : columns === 1 ? "sm:grid-cols-1" : "sm:grid-cols-2";

  return <div className={cx("grid gap-3", gridClassName)}>{items.map((item) => renderMetricCard(item))}</div>;
}

function MetricGridSkeleton({ items = 4 }: { items?: number }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {Array.from({ length: items }, (_, index) => (
        <div
          key={index}
          className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4"
        >
          <div className="h-3 w-24 rounded-full bg-white/8" />
          <div className="mt-4 h-7 w-28 rounded-full bg-white/10" />
          <div className="mt-3 h-3 w-40 rounded-full bg-white/6" />
        </div>
      ))}
    </div>
  );
}

function getRiskStatTone(
  tone: RiskPosture["tone"],
): "accent" | "success" | "warning" {
  switch (tone) {
    case "success":
      return "success";
    case "warning":
      return "warning";
    default:
      return "accent";
  }
}

function getGuardrailTone(
  ratio: number,
): "danger" | "info" | "success" | "warning" {
  if (ratio >= 0.85) {
    return "danger";
  }

  if (ratio >= 0.55) {
    return "warning";
  }

  return "success";
}

function GuardrailCard({
  helper,
  label,
  limit,
  used,
}: {
  label: string;
  used: number;
  limit: number;
  helper: string;
}) {
  const ratio = limit > 0 ? Math.min(used / limit, 1) : 0;
  const progressTone = limit > 0 ? getGuardrailTone(ratio) : "info";
  const badgeTone = progressTone === "danger" ? "danger" : progressTone === "warning" ? "warning" : progressTone === "success" ? "success" : "info";

  return (
    <div className="rounded-[22px] border border-white/8 bg-white/[0.03] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-medium text-white">{label}</div>
          <div className="mt-1 text-sm leading-6 text-slate-400">{helper}</div>
        </div>
        <div className="text-right">
          <div className="text-sm font-medium text-white">
            {limit > 0 ? `${formatCurrency(used)} / ${formatCurrency(limit)}` : "Disabled"}
          </div>
          <div className="mt-2 flex justify-end">
            <Badge tone={badgeTone}>
              {limit > 0 ? `${Math.round(ratio * 100)}% used` : "No cap"}
            </Badge>
          </div>
        </div>
      </div>
      <ProgressBar
        className="mt-4"
        value={limit > 0 ? used : 0}
        max={limit > 0 ? limit : 1}
        tone={progressTone}
      />
    </div>
  );
}

function DashboardTableState({
  copy,
  eyebrow,
}: {
  eyebrow: string;
  copy: EmptyCopy;
}) {
  return (
    <EmptyState
      eyebrow={eyebrow}
      title={copy.title}
      description={copy.description}
      className="min-h-[320px]"
    />
  );
}

function DashboardStatusBanner({
  isInitialLoading,
  isLatestHistoryLoading,
  latestHistoricalSession,
  mode,
  snapshot,
}: {
  isInitialLoading: boolean;
  mode: DashboardViewMode;
  snapshot: CurrentSessionSnapshot | undefined;
  latestHistoricalSession: SessionHistoryEntry | null;
  isLatestHistoryLoading: boolean;
}) {
  if (isInitialLoading || mode === "live") {
    return null;
  }

  if (mode === "stopped_snapshot" && snapshot) {
    return (
      <section className="rounded-[24px] border border-amber-300/18 bg-amber-300/10 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="warning">Stopped snapshot</Badge>
          <span className="text-sm font-medium text-amber-100">
            {snapshot.session.id} has already stopped
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-amber-50/90">
          Dashboard đang giữ snapshot cuối cùng đã persist lúc {formatDateTime(snapshot.session.last_event_at)}.
          SSE được giữ idle cho tới khi có current session mới ở trạng thái running.
        </p>
      </section>
    );
  }

  if (mode === "no_session") {
    return (
      <section className="rounded-[24px] border border-sky-300/18 bg-sky-300/10 px-5 py-4">
        <div className="flex flex-wrap items-center gap-3">
          <Badge tone="info">No live session</Badge>
          <span className="text-sm font-medium text-sky-100">
            Dashboard is idle
          </span>
        </div>
        <p className="mt-3 text-sm leading-6 text-sky-50/90">
          Route này chỉ stream current session khi session đang running. Hiện chưa có live session nên dashboard chuyển sang trạng thái tham chiếu.
        </p>
        <p className="mt-2 text-sm leading-6 text-sky-50/80">
          {isLatestHistoryLoading
            ? "Đang đọc session lịch sử gần nhất để gợi ý context tiếp theo."
            : latestHistoricalSession
              ? `Session gần nhất là ${latestHistoricalSession.session_id}, updated ${formatDateTime(latestHistoricalSession.last_event_at)} với PnL ${formatSignedCurrency(latestHistoricalSession.total_pnl)}.`
              : "Chưa có historical session nào được lưu để gợi ý lại."}
        </p>
      </section>
    );
  }

  return (
    <section className="rounded-[24px] border border-rose-300/18 bg-rose-300/10 px-5 py-4">
      <div className="flex flex-wrap items-center gap-3">
        <Badge tone="danger">Backend down</Badge>
        <span className="text-sm font-medium text-rose-100">
          Current snapshot unavailable
        </span>
      </div>
      <p className="mt-3 text-sm leading-6 text-rose-50/90">
        Dashboard chưa hydrate được current session vì Core Trading đang không phản hồi. Khi upstream hồi phục, route này sẽ đọc lại snapshot và chỉ mount SSE nếu session đang running.
      </p>
    </section>
  );
}

function buildLatestHistoricalMetrics(session: SessionHistoryEntry): MetricItem[] {
  return [
    {
      label: "Session ID",
      value: session.session_id,
      hint: `Status ${session.status}`,
    },
    {
      label: "Last update",
      value: formatDateTime(session.last_event_at),
      hint: `Started ${formatDateTime(session.started_at)}`,
    },
    {
      label: "Total PnL",
      value: formatSignedCurrency(session.total_pnl),
      hint: `Max drawdown ${formatCurrency(session.max_drawdown)}`,
      valueClassName: session.total_pnl < 0 ? "text-rose-200" : "text-emerald-200",
    },
    {
      label: "Filled orders",
      value: formatNumber(session.filled_orders, 0),
      hint: `Reset ${formatNumber(session.reset_count, 0)} lần`,
    },
  ];
}

function buildPortfolioMetrics(snapshot: CurrentSessionSnapshot): MetricItem[] {
  const openExposure = getOpenExposure(snapshot.positions);

  return [
    {
      label: "Cash balance",
      value: formatCurrency(snapshot.portfolio.cash_balance),
      hint: "Phần tiền mặt còn có thể dùng cho session paper hiện tại.",
    },
    {
      label: "Unrealized PnL",
      value: formatSignedCurrency(snapshot.portfolio.unrealized_pnl),
      hint: `${snapshot.positions.length} vị thế đang còn mở trong book hiện tại.`,
      valueClassName:
        snapshot.portfolio.unrealized_pnl < 0 ? "text-rose-200" : "text-emerald-200",
    },
    {
      label: "Realized PnL",
      value: formatSignedCurrency(snapshot.portfolio.realized_pnl),
      hint: "Đóng góp từ các lệnh đã khép lại trong session hiện tại.",
      valueClassName:
        snapshot.portfolio.realized_pnl < 0 ? "text-rose-200" : "text-emerald-200",
    },
    {
      label: "Gross exposure",
      value: formatCurrency(openExposure),
      hint: "Tổng market value tuyệt đối của các vị thế còn mở.",
    },
  ];
}

function buildReportMetrics(snapshot: CurrentSessionSnapshot): MetricItem[] {
  return [
    {
      label: "Filled orders",
      value: formatNumber(snapshot.report.filled_orders, 0),
      hint: "Số fill đã được ghi vào report của session.",
    },
    {
      label: "Rejected signals",
      value: formatNumber(snapshot.report.rejected_signals, 0),
      hint: "Số tín hiệu bị chặn bởi rule hoặc execution constraint.",
    },
    {
      label: "Fees paid",
      value: formatCurrency(snapshot.report.fees_paid),
      hint: "Tổng phí cộng dồn từ các paper order đã fill.",
    },
    {
      label: "Slippage cost",
      value: formatCurrency(snapshot.report.slippage_cost),
      hint: "Chi phí trượt giá ước tính so với requested price.",
    },
    {
      label: "Max drawdown",
      value: formatCurrency(snapshot.report.max_drawdown),
      hint: "Mức drawdown lớn nhất ghi nhận được trong timeline.",
    },
    {
      label: "Session resets",
      value: formatNumber(snapshot.report.reset_count, 0),
      hint: "Số lần session paper hiện tại đã được reset.",
    },
  ];
}

function buildRuleMetrics(snapshot: CurrentSessionSnapshot): MetricItem[] {
  return [
    {
      label: "Fee rate",
      value: formatPercentRatio(snapshot.rules.fee_rate, 3),
      hint: "Tỷ lệ phí áp lên từng fill paper.",
    },
    {
      label: "Slippage rate",
      value: formatPercentRatio(snapshot.rules.slippage_rate, 3),
      hint: "Tỷ lệ slippage giả lập áp trên mỗi giao dịch.",
    },
    {
      label: "Max order notional",
      value: formatGuardLimit(snapshot.rules.risk_controls.max_order_notional),
      hint: "Giới hạn notional tối đa cho mỗi order trước khi signal bị từ chối.",
    },
    {
      label: "Max position quantity",
      value:
        Number(snapshot.rules.risk_controls.max_position_quantity ?? 0) > 0
          ? formatNumber(snapshot.rules.risk_controls.max_position_quantity)
          : "Disabled",
      hint: "Giới hạn quantity theo từng symbol do risk control áp đặt.",
    },
    {
      label: "Cooldown",
      value: formatDuration(snapshot.rules.risk_controls.cooldown_seconds),
      hint: "Khoảng nghỉ tối thiểu giữa các order hợp lệ.",
    },
    {
      label: "Allowed symbols",
      value: snapshot.rules.risk_controls.allowed_symbols.length
        ? `${snapshot.rules.risk_controls.allowed_symbols.length} scoped`
        : "All symbols",
      hint: "Tập symbol hiện được phép giao dịch trong paper engine.",
    },
  ];
}

function renderSymbolSummary(snapshot: CurrentSessionSnapshot) {
  if (!snapshot.report.symbols.length) {
    return (
      <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] p-4 text-sm leading-6 text-slate-400">
        Chưa có fill nào đủ để tạo summary theo symbol. Khi order bắt đầu khớp, khu vực này sẽ cho thấy symbol nào bận nhất và chịu phí nhiều nhất.
      </div>
    );
  }

  return (
    <div className="grid gap-3">
      {snapshot.report.symbols.slice(0, 4).map((symbol) => (
        <div
          key={symbol.symbol}
          className="flex flex-wrap items-center justify-between gap-3 rounded-[22px] border border-white/8 bg-white/[0.03] p-4"
        >
          <div>
            <div className="text-sm font-medium text-white">{symbol.symbol}</div>
            <div className="mt-1 text-sm text-slate-400">
              {formatNumber(symbol.filled_orders, 0)} filled orders
            </div>
          </div>
          <Badge tone="info">{formatCurrency(symbol.fees_paid)} fees</Badge>
        </div>
      ))}
    </div>
  );
}

function buildExposureChartPoints(snapshot?: CurrentSessionSnapshot) {
  if (!snapshot) {
    return [];
  }

  return [...snapshot.positions]
    .sort((left, right) => Math.abs(Number(right.market_value ?? 0)) - Math.abs(Number(left.market_value ?? 0)))
    .slice(0, 5)
    .map((position) => ({
      label: position.symbol,
      value: Math.abs(Number(position.market_value ?? 0)),
    }));
}

export function DashboardLiveMonitor() {
  const currentSnapshotQuery = useCurrentSessionSnapshotQuery();
  const coreHealthQuery = useCoreHealthQuery();
  const coreAvailability = resolveServiceAvailability(coreHealthQuery);
  const snapshot = currentSnapshotQuery.data;
  const isInitialLoading = currentSnapshotQuery.isPending && !snapshot;
  const dashboardMode = resolveDashboardViewMode(
    snapshot,
    currentSnapshotQuery.error,
    coreAvailability,
  );
  const latestHistoryQuery = useSessionHistoryQuery(
    { limit: 1, offset: 0 },
    {
      enabled: dashboardMode === "no_session",
    },
  );
  const latestHistoricalSession = getMostRecentHistoricalSession(latestHistoryQuery.data);
  const currentErrorCopy = getDashboardEmptyCopy(
    dashboardMode,
    currentSnapshotQuery.error,
    coreAvailability,
    isInitialLoading,
  );
  const timelineStreamStatus = useOperatorUiStore(selectTimelineStreamStatus);
  const timelineStreamEnabled = snapshot?.session.status === "running";
  const timelineStream = useCurrentTimelineStream({
    enabled: timelineStreamEnabled,
  });

  const isRefreshing = currentSnapshotQuery.isFetching && !isInitialLoading;
  const timelinePoints = snapshot?.timeline ?? [];
  const latestTimelinePoint = timelineStream.lastPoint ?? timelinePoints[timelinePoints.length - 1];
  const riskPosture = getRiskPosture(snapshot);
  const operatorSnapshotSummary = buildOperatorSnapshotSummary(
    dashboardMode,
    snapshot,
    latestHistoricalSession,
    riskPosture,
    currentErrorCopy,
    isInitialLoading,
  );
  const attentionItems = buildAttentionItems(
    dashboardMode,
    snapshot,
    latestHistoricalSession,
    coreAvailability,
    riskPosture,
    timelineStreamStatus,
    isInitialLoading,
    timelineStream.error ?? undefined,
  );
  const openExposure = getOpenExposure(snapshot?.positions ?? []);
  const currentLossUsage = Math.max(-Number(snapshot?.report.total_pnl ?? 0), 0);
  const maxDailyLoss = Number(snapshot?.rules.risk_controls.max_daily_loss ?? 0);
  const maxOpenNotional = Number(snapshot?.rules.risk_controls.max_open_notional ?? 0);
  const pageHeaderTone = getPageHeaderTone(dashboardMode, isInitialLoading);
  const sessionStatusTone =
    dashboardMode === "backend_down"
      ? "danger"
      : dashboardMode === "no_session"
        ? "info"
        : getSessionStatusBadgeTone(snapshot?.session.status);
  const sessionBadgeLabel = isInitialLoading
    ? "loading"
    : dashboardMode === "backend_down"
      ? "backend down"
      : dashboardMode === "no_session"
        ? "no live session"
        : snapshot?.session.status ?? "unavailable";
  const actionDescription = (() => {
    if (snapshot && dashboardMode === "live") {
      return `${snapshot.session.id} đang running. Equity ${formatCurrency(snapshot.portfolio.total_equity)}, ${formatNumber(snapshot.positions.length, 0)} vị thế mở, ${formatNumber(snapshot.orders.length, 0)} fill gần nhất.`;
    }

    if (snapshot && dashboardMode === "stopped_snapshot") {
      return `${snapshot.session.id} đã stopped. Dashboard đang giữ snapshot cuối tại ${formatDateTime(snapshot.session.last_event_at)} để anh review nhanh trước khi mở historical detail.`;
    }

    if (dashboardMode === "no_session" && latestHistoricalSession) {
      return `Hiện chưa có current session. Session gần nhất trong history là ${latestHistoricalSession.session_id}, updated ${formatDateTime(latestHistoricalSession.last_event_at)} với PnL ${formatSignedCurrency(latestHistoricalSession.total_pnl)}.`;
    }

    return currentErrorCopy.description;
  })();
  const timelineEyebrow =
    dashboardMode === "live"
      ? "Live timeline"
      : dashboardMode === "stopped_snapshot"
        ? "Stopped snapshot"
        : "Current session";
  const timelineDescription =
    dashboardMode === "live"
      ? "Biểu đồ realtime của paper session hiện tại."
      : dashboardMode === "stopped_snapshot"
        ? "Đồ thị snapshot cuối của session đã dừng."
        : "Khu vực này sẽ hiện lại timeline khi current session đang chạy.";

  const headerAside = (
    <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
      <div className="flex flex-wrap items-center gap-3">
        <Badge
          tone={sessionStatusTone}
          leading={<PulseIcon className="size-3" />}
        >
          {sessionBadgeLabel}
        </Badge>
        <Badge tone={getStreamBadgeTone(timelineStreamStatus)}>
          SSE {describeTimelineStreamStatus(timelineStreamStatus)}
        </Badge>
        {isRefreshing ? <Badge tone="info">Refreshing snapshot</Badge> : null}
      </div>

      <p className="mt-4 text-sm leading-6 text-slate-400">{actionDescription}</p>

      <div className="mt-4 flex flex-wrap gap-3 text-sm text-slate-400">
        <span>
          Last event:{" "}
          {dashboardMode === "no_session"
            ? latestHistoricalSession?.session_id ?? "-"
            : latestTimelinePoint?.event_type ?? "-"}
        </span>
        <span>
          At{" "}
          {formatShortTime(
            dashboardMode === "no_session"
              ? latestHistoricalSession?.last_event_at
              : latestTimelinePoint?.timestamp,
          )}
        </span>
        {timelineStream.reconnectCount > 0 ? (
          <span>Reconnects: {timelineStream.reconnectCount}</span>
        ) : null}
      </div>

      <DisclosurePanel className="mt-4" label="View route notes" contentClassName="space-y-2">
        <p>Route này là nơi duy nhất mount SSE cho current session, nhưng chỉ khi current session đang `running`. Sessions vẫn là bề mặt historical chỉ-đọc.</p>
        <p>
          {dashboardMode === "stopped_snapshot"
            ? "Session hiện tại đã stopped nên dashboard giữ last known snapshot và không reconnect stream."
            : dashboardMode === "no_session"
              ? "Hiện chưa có current session nên dashboard chuyển sang idle state và gợi ý historical context gần nhất."
              : dashboardMode === "backend_down"
                ? "Core Trading đang down nên current-session reads chưa hydrate được cho tới khi upstream hồi phục."
                : "Nếu stream bị gián đoạn, anh vẫn có thể nhìn snapshot hiện tại, nhưng timeline và trạng thái live sẽ chậm hơn thực tế cho tới khi reconnect xong."}
        </p>
      </DisclosurePanel>

      {timelineStreamEnabled && timelineStream.error ? (
        <p className="mt-4 rounded-[18px] border border-amber-300/20 bg-amber-300/10 px-4 py-3 text-sm leading-6 text-amber-100">
          Live stream degraded: {timelineStream.error.message}
        </p>
      ) : null}
    </div>
  );

  const pageMeta = [
    { label: "Mode", value: getDashboardModeLabel(dashboardMode, isInitialLoading) },
    { label: "Current session", value: snapshot?.session.id ?? "None" },
    {
      label: "Last event",
      value: formatDateTime(snapshot?.session.last_event_at ?? latestHistoricalSession?.last_event_at),
    },
    {
      label: snapshot ? "Open positions" : "Latest history",
      value: snapshot
        ? formatNumber(snapshot.positions.length, 0)
        : latestHistoricalSession?.session_id ?? "-",
    },
  ];

  const positions = [...(snapshot?.positions ?? [])].sort(
    (left, right) => Math.abs(Number(right.market_value ?? 0)) - Math.abs(Number(left.market_value ?? 0)),
  );
  const orders = [...(snapshot?.orders ?? [])].sort(
    (left, right) =>
      new Date(right.executed_at).getTime() - new Date(left.executed_at).getTime(),
  );
  const leadingPositionSymbol = positions[0]?.symbol;
  const latestOrderId = orders[0]?.id;
  const exposureChartPoints = buildExposureChartPoints(snapshot);
  const exposureChartOption = exposureChartPoints.length
    ? createHorizontalBarOption(exposureChartPoints, {
        formatter: (value) => formatCurrency(value),
      })
    : undefined;

  return (
    <div className="space-y-6">
      <PageHeader
        variant="compact"
        tone={pageHeaderTone}
        eyebrow="Current Session"
        title="Current-session live monitor"
        description={
          isInitialLoading
            ? "Dashboard đang nạp current-session snapshot. Nếu session hiện tại đang chạy, realtime stream sẽ được gắn ngay sau khi snapshot hoàn tất."
            : dashboardMode === "live"
            ? "Theo dõi realtime cho paper session đang chạy; lịch sử immutable vẫn được tách riêng ở Sessions."
            : dashboardMode === "stopped_snapshot"
              ? "Session hiện tại đã dừng nên dashboard đang giữ snapshot cuối để review nhanh, còn historical detail đầy đủ vẫn nằm ở Sessions."
              : dashboardMode === "no_session"
                ? "Hiện không có current session nên dashboard ở trạng thái idle và chỉ gợi ý context từ history gần nhất."
                : "Current-session reads đang unavailable vì Core Trading không phản hồi."
        }
        actions={
          <>
            <Link
              to="/lab"
              className={cx(
                actionLinkClassName,
                "border-transparent bg-[linear-gradient(135deg,#f4be51_0%,#ffd978_45%,#42d9ba_100%)] text-slate-950 shadow-[0_18px_32px_rgba(244,190,81,0.24)] hover:brightness-105",
              )}
            >
              Open operator lab
            </Link>
            <Link
              to="/sessions"
              className={cx(
                actionLinkClassName,
                "border-white/10 bg-white/[0.05] text-white hover:border-white/16 hover:bg-white/[0.08]",
              )}
            >
              Review session history
            </Link>
          </>
        }
        meta={pageMeta}
        aside={headerAside}
      />

      <DashboardStatusBanner
        isInitialLoading={isInitialLoading}
        mode={dashboardMode}
        snapshot={snapshot}
        latestHistoricalSession={latestHistoricalSession}
        isLatestHistoryLoading={latestHistoryQuery.isPending || latestHistoryQuery.isFetching}
      />

      {dashboardMode === "no_session" ? (
        <Panel
          eyebrow="Latest history"
          title="Most recent stored session"
          description="Khi chưa có live session, dashboard chỉ dùng panel này để nhắc lại context lịch sử gần nhất thay vì giả vờ là view realtime."
          tone="soft"
        >
          {latestHistoryQuery.isPending || latestHistoryQuery.isFetching ? (
            <MetricGridSkeleton items={4} />
          ) : latestHistoricalSession ? (
            <MetricGrid items={buildLatestHistoricalMetrics(latestHistoricalSession)} />
          ) : (
            <EmptyState
              eyebrow="Latest history"
              title="No stored session yet"
              description="Chưa có current session và cũng chưa có historical session nào đã lưu. Vào Lab để start session đầu tiên."
            />
          )}
        </Panel>
      ) : null}

      <SummaryStrip
        items={[
          {
            badge: (
              <Badge
                tone={
                  dashboardMode === "backend_down"
                    ? "danger"
                    : dashboardMode === "stopped_snapshot"
                      ? "warning"
                      : dashboardMode === "live"
                        ? "success"
                        : "neutral"
                }
              >
                {sessionBadgeLabel}
              </Badge>
            ),
            label: "Session",
            meta: snapshot?.session.id
              ? dashboardMode === "stopped_snapshot"
                ? `frozen snapshot · SSE ${describeTimelineStreamStatus(timelineStreamStatus)}`
                : `SSE ${describeTimelineStreamStatus(timelineStreamStatus)}`
              : currentErrorCopy.description,
            tone:
              dashboardMode === "backend_down"
                ? "danger"
                : dashboardMode === "stopped_snapshot"
                  ? "warning"
                  : dashboardMode === "live"
                    ? "accent"
                    : "neutral",
            value:
              snapshot?.session.id ??
              latestHistoricalSession?.session_id ??
              getDashboardModeLabel(dashboardMode, isInitialLoading),
          },
          {
            badge: (
              <Badge tone={!snapshot || snapshot.report.total_pnl >= 0 ? "success" : "danger"}>
                PnL
              </Badge>
            ),
            label: "Total PnL",
            meta: snapshot
              ? `${formatNumber(snapshot.report.filled_orders, 0)} fills · max DD ${formatCurrency(snapshot.report.max_drawdown)}`
              : currentErrorCopy.description,
            tone:
              snapshot && snapshot.report.total_pnl < 0
                ? "danger"
                : snapshot
                  ? "success"
                  : dashboardMode === "backend_down"
                    ? "danger"
                    : "neutral",
            value: snapshot ? formatSignedCurrency(snapshot.report.total_pnl) : "-",
          },
          {
            badge: <Badge tone={snapshot ? "info" : "neutral"}>Equity</Badge>,
            label: "Total equity",
            meta: snapshot
              ? `${formatCurrency(openExposure)} open exposure · ${formatNumber(snapshot.positions.length, 0)} positions`
              : currentErrorCopy.description,
            tone: snapshot ? "accent" : dashboardMode === "backend_down" ? "danger" : "neutral",
            value: snapshot ? formatCurrency(snapshot.portfolio.total_equity) : dashboardMode === "no_session" ? "Idle" : "-",
          },
          {
            badge: (
              <Badge
                tone={
                  snapshot
                    ? riskPosture.tone === "success"
                      ? "success"
                      : riskPosture.tone === "warning"
                        ? "warning"
                        : "info"
                    : "neutral"
                }
              >
                {snapshot ? riskPosture.trend : "Pending"}
              </Badge>
            ),
            label: "Risk posture",
            meta:
              snapshot
                ? `${formatPercentRatio(maxDailyLoss > 0 ? currentLossUsage / maxDailyLoss : 0)} loss budget · ${formatPercentRatio(maxOpenNotional > 0 ? openExposure / maxOpenNotional : 0)} open notional`
                : currentErrorCopy.description,
            tone: snapshot ? getRiskStatTone(riskPosture.tone) : "neutral",
            value:
              snapshot
                ? riskPosture.label
                : dashboardMode === "backend_down"
                  ? "Unavailable"
                  : "Waiting",
          },
        ]}
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.85fr)]">
        <ChartPanel
          tone="soft"
          eyebrow={timelineEyebrow}
          title={
            <span className="inline-flex items-center gap-2">
              Equity and drawdown
              <InfoTooltip content="Biểu đồ này chỉ đọc current session. Các route lịch sử không nhận mutation realtime từ SSE." />
            </span>
          }
          description={timelineDescription}
          chart={{
            emptyDescription:
              currentSnapshotQuery.error && !snapshot
                ? currentErrorCopy.description
                : "Paper engine chưa ghi timeline point nào cho session hiện tại.",
            emptyTitle:
              currentSnapshotQuery.error && !snapshot
                ? currentErrorCopy.title
                : "Current timeline is waiting for points",
            height: 360,
            loading: isInitialLoading,
            option: createCurrentTimelineOption(timelinePoints),
          }}
          footer={
            snapshot ? (
              <>
                <Badge tone={getStreamBadgeTone(timelineStreamStatus)}>
                  SSE {describeTimelineStreamStatus(timelineStreamStatus)}
                </Badge>
                <span>Points: {formatNumber(timelinePoints.length, 0)}</span>
                <span>Last event: {latestTimelinePoint?.event_type ?? "-"}</span>
                <span>At {formatShortTime(latestTimelinePoint?.timestamp)}</span>
                <span>Max drawdown: {formatCurrency(snapshot.report.max_drawdown)}</span>
              </>
            ) : dashboardMode === "no_session" && latestHistoricalSession ? (
              <>
                <Badge tone="info">Historical context</Badge>
                <span>{latestHistoricalSession.session_id}</span>
                <span>PnL {formatSignedCurrency(latestHistoricalSession.total_pnl)}</span>
                <span>Updated {formatDateTime(latestHistoricalSession.last_event_at)}</span>
              </>
            ) : (
              <>
                <Badge tone={dashboardMode === "backend_down" ? "danger" : "warning"}>
                  {getDashboardModeLabel(dashboardMode, isInitialLoading)}
                </Badge>
                <span>{currentErrorCopy.title}</span>
              </>
            )
          }
        />

        <Panel
          eyebrow="Operator focus"
          title={
            <span className="inline-flex items-center gap-2">
              Control room
              <InfoTooltip content="Khu vực này gom lại điều gì đang quan trọng nhất, anh nên làm gì tiếp theo và các ghi chú cần xem khi có bất thường." />
            </span>
          }
          description="Tóm tắt ngắn trạng thái hiện tại và bước kế tiếp."
          tone={dashboardMode === "live" ? "accent" : "soft"}
        >
          <div className="grid gap-4">
            <div className="grid gap-3">
              <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Current focus
                </div>
                <div className="mt-2 text-lg font-medium text-white">
                  {operatorSnapshotSummary.currentFocus}
                </div>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Next move
                </div>
                <div className="mt-2 text-lg font-medium text-white">
                  {operatorSnapshotSummary.nextMove}
                </div>
              </div>
              <div className="rounded-[22px] border border-white/8 bg-white/[0.04] p-4">
                <div className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Mode
                </div>
                <div className="mt-2 text-lg font-medium text-white">
                  {operatorSnapshotSummary.mode}
                </div>
              </div>
            </div>

            <DisclosurePanel
              label="View alerts"
              contentClassName="grid gap-3"
            >
              {attentionItems.map((item) => (
                <div
                  key={item.title}
                  className="rounded-[18px] border border-white/8 bg-white/[0.03] p-4"
                >
                  <div className="flex flex-wrap items-center gap-3">
                    <Badge tone={item.tone}>{item.title}</Badge>
                  </div>
                  <p className="mt-3 text-sm leading-6 text-slate-300">{item.detail}</p>
                </div>
              ))}
            </DisclosurePanel>
          </div>
        </Panel>
      </section>

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1.02fr)]">
        <Panel
          eyebrow="Guardrails"
          title={
            <span className="inline-flex items-center gap-2">
              Risk budget
              <InfoTooltip content="Các thước đo này cho thấy session đang dùng bao nhiêu ngân sách rủi ro so với cấu hình. Chúng không tự thay đổi rule, chỉ giúp anh thấy nhanh mức tiêu thụ." />
            </span>
          }
          description="Giới hạn cấu hình và mức sử dụng hiện tại."
        >
          {snapshot ? (
            <div className="space-y-6">
              <div className="grid gap-3">
                <GuardrailCard
                  label="Daily loss guard"
                  used={currentLossUsage}
                  limit={maxDailyLoss}
                  helper="Dùng live total PnL để cho biết ngân sách lỗ trong ngày đã bị ăn bao nhiêu."
                />
                <GuardrailCard
                  label="Open notional guard"
                  used={openExposure}
                  limit={maxOpenNotional}
                  helper="Theo dõi tổng exposure tuyệt đối của các vị thế đang mở."
                />
              </div>

              <MetricGrid items={buildRuleMetrics(snapshot)} columns={3} />

              <div>
                <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  Allowed symbols
                </div>
                <div className="flex flex-wrap gap-2">
                  {snapshot.rules.risk_controls.allowed_symbols.length ? (
                    snapshot.rules.risk_controls.allowed_symbols.map((symbol) => (
                      <Badge key={symbol} tone="info">
                        {symbol}
                      </Badge>
                    ))
                  ) : (
                    <Badge>All symbols</Badge>
                  )}
                </div>
              </div>
            </div>
          ) : isInitialLoading ? (
            <MetricGridSkeleton items={6} />
          ) : (
            <EmptyState
              eyebrow="Current session"
              title={currentErrorCopy.title}
              description={currentErrorCopy.description}
            />
          )}
        </Panel>

        <div className="grid gap-6">
          <Panel
            eyebrow="Portfolio"
            title={
              <span className="inline-flex items-center gap-2">
                Current portfolio
                <InfoTooltip content="Khối này giữ các số tổng quan quan trọng nhất cho paper account hiện tại. Nếu cần chi tiết từng vị thế, xem bảng Open positions phía dưới." />
              </span>
            }
            description="Các số tổng quan chính của paper account hiện tại."
          >
            {snapshot ? (
              <MetricGrid items={buildPortfolioMetrics(snapshot)} />
            ) : isInitialLoading ? (
              <MetricGridSkeleton />
            ) : (
              <EmptyState
                eyebrow="Current session"
                title={currentErrorCopy.title}
                description={currentErrorCopy.description}
              />
            )}
          </Panel>

          <ChartPanel
            eyebrow="Exposure"
            title={
              <span className="inline-flex items-center gap-2">
                Exposure by symbol
                <InfoTooltip content="Biểu đồ này xếp các symbol theo market value tuyệt đối để anh nhận ra ngay symbol nào đang chiếm rủi ro lớn nhất." />
              </span>
            }
            description="Top symbol đang chiếm exposure lớn nhất."
            chart={{
              emptyDescription: "Chưa có vị thế mở nên chưa có exposure theo symbol để hiển thị.",
              emptyTitle: "No exposure by symbol",
              height: 260,
              loading: isInitialLoading,
              option: exposureChartOption,
            }}
            footer={
              snapshot ? (
                <>
                  <Badge tone="info">{formatNumber(snapshot.positions.length, 0)} positions</Badge>
                  <span>Total exposure {formatCurrency(openExposure)}</span>
                </>
              ) : undefined
            }
          />

          <Panel
            eyebrow="Execution"
            title={
              <span className="inline-flex items-center gap-2">
                Execution snapshot
                <InfoTooltip content="Khối này gom số fill, slippage, drawdown và symbol bận nhất để anh đọc nhanh chất lượng execution mà không cần mở detail sâu hơn." />
              </span>
            }
            description="Nhìn nhanh fill, drag và symbol bận nhất."
          >
            {snapshot ? (
              <div className="space-y-6">
                <MetricGrid items={buildReportMetrics(snapshot)} columns={3} />
                <div>
                  <div className="mb-3 text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    Busiest symbols
                  </div>
                  {renderSymbolSummary(snapshot)}
                </div>
              </div>
            ) : isInitialLoading ? (
              <MetricGridSkeleton items={6} />
            ) : (
              <EmptyState
                eyebrow="Current session"
                title={currentErrorCopy.title}
                description={currentErrorCopy.description}
              />
            )}
          </Panel>
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <Panel
          eyebrow="Current portfolio"
          title={
            <span className="inline-flex items-center gap-2">
              Open positions
              <InfoTooltip content="Bảng này luôn sort theo exposure giảm dần để rủi ro lớn nhất nổi lên trước. Dùng nó khi cần xem symbol nào đang kéo exposure của session." />
            </span>
          }
          description="Sort theo exposure giảm dần để nhìn rủi ro nhanh hơn."
        >
          {snapshot ? (
            <DataTable
              caption="Current positions"
              columns={[
                { key: "symbol", header: "Symbol", cell: (row) => row.symbol },
                {
                  key: "quantity",
                  header: "Qty",
                  align: "right",
                  cell: (row) => formatNumber(row.quantity),
                },
                {
                  key: "average",
                  header: "Avg",
                  align: "right",
                  cell: (row) => formatCurrency(row.average_price),
                },
                {
                  key: "mark",
                  header: "Mark",
                  align: "right",
                  cell: (row) => formatCurrency(row.market_price),
                },
                {
                  key: "value",
                  header: "Value",
                  align: "right",
                  cell: (row) => formatCurrency(row.market_value),
                },
                {
                  key: "unrealized",
                  header: "UPnL",
                  align: "right",
                  cell: (row) => (
                    <span
                      className={
                        row.unrealized_pnl < 0 ? "text-rose-200" : "text-emerald-200"
                      }
                    >
                      {formatSignedCurrency(row.unrealized_pnl)}
                    </span>
                  ),
                },
              ]}
              rows={positions}
              getRowId={(row) => row.symbol}
              getRowClassName={(row) =>
                row.symbol === leadingPositionSymbol ? "bg-white/[0.02]" : undefined
              }
              emptyTitle="No open positions"
              emptyDescription="Paper account hiện chưa có vị thế mở nào để theo dõi."
            />
          ) : isInitialLoading ? (
            <DashboardTableState
              eyebrow="Current positions"
              copy={{
                title: "Loading positions",
                description: "Đang tải portfolio hiện tại cho live monitor.",
              }}
            />
          ) : (
            <DashboardTableState eyebrow="Current positions" copy={currentErrorCopy} />
          )}
        </Panel>

        <Panel
          eyebrow="Execution feed"
          title={
            <span className="inline-flex items-center gap-2">
              Recent orders
              <InfoTooltip content="Bảng này chỉ hiện order gần nhất của current session. Khi cần report, audit và timeline bất biến của session đã lưu, chuyển sang Sessions." />
            </span>
          }
          description="Các order gần nhất của current session."
        >
          {snapshot ? (
            <DataTable
              caption="Current orders"
              columns={[
                {
                  key: "executed_at",
                  header: "Time",
                  cell: (row) => formatDateTime(row.executed_at),
                },
                { key: "symbol", header: "Symbol", cell: (row) => row.symbol },
                {
                  key: "side",
                  header: "Side",
                  cell: (row) => (
                    <Badge tone={row.side === "buy" ? "success" : "danger"}>{row.side}</Badge>
                  ),
                },
                {
                  key: "quantity",
                  header: "Qty",
                  align: "right",
                  cell: (row) => {
                    const requestedQuantity = getOrderRequestedQuantity(row);

                    return (
                      <span className="inline-flex flex-col items-end gap-1">
                        <span>{formatNumber(row.quantity)}</span>
                        {requestedQuantity > row.quantity ? (
                          <span className="text-xs text-slate-500">
                            of {formatNumber(requestedQuantity)}
                          </span>
                        ) : null}
                      </span>
                    );
                  },
                },
                {
                  key: "price",
                  header: "Price",
                  align: "right",
                  cell: (row) => formatCurrency(row.price),
                },
                {
                  key: "execution",
                  header: "Execution",
                  className: "min-w-[220px]",
                  cell: (row) => {
                    const fillCount = getOrderFillCount(row);
                    const remainingQuantity = getOrderRemainingQuantity(row);

                    return (
                      <span className="inline-flex flex-col items-start gap-1.5">
                        <Badge tone={getOrderStatusBadgeTone(row.status)}>
                          {formatOrderStatusLabel(row.status)}
                        </Badge>
                        <span className="text-xs text-slate-500">
                          {formatNumber(fillCount, 0)} {fillCount === 1 ? "fill" : "fills"} ·{" "}
                          {formatNumber(remainingQuantity)} remaining
                        </span>
                        {row.terminal_reason ? (
                          <span className="text-xs text-slate-400">
                            {formatOrderStatusLabel(row.terminal_reason)}
                          </span>
                        ) : null}
                      </span>
                    );
                  },
                },
                {
                  key: "fee",
                  header: "Fee",
                  align: "right",
                  cell: (row) => formatCurrency(row.fee),
                },
              ]}
              rows={orders}
              getRowId={(row) => row.id}
              getRowClassName={(row) =>
                row.id === latestOrderId ? "bg-white/[0.02]" : undefined
              }
              emptyTitle="No recent orders"
              emptyDescription="Khi session bắt đầu fill signal, order sẽ xuất hiện tại đây."
            />
          ) : isInitialLoading ? (
            <DashboardTableState
              eyebrow="Current orders"
              copy={{
                title: "Loading orders",
                description: "Đang tải order feed của current session cho live monitor.",
              }}
            />
          ) : (
            <DashboardTableState eyebrow="Current orders" copy={currentErrorCopy} />
          )}
        </Panel>
      </section>
    </div>
  );
}
