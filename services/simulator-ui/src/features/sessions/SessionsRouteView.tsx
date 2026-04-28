import {
  type FormEvent,
  startTransition,
  useEffect,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";

import { formatOperatorErrorMessage } from "../../shared/api";
import { ApiClientError } from "../../shared/api/http";
import {
  ChartPanel,
  createHorizontalBarOption,
  createStackedStatusBarOption,
  createTimelineAreaOption,
} from "../../shared/charts";
import { resolveSelectedSessionId } from "../../shared/lib";
import {
  resolveServiceAvailability,
  useCoreHealthQuery,
  useCurrentSessionQuery,
  usePaperReportQuery,
  usePaperTimelineQuery,
  useSessionHistoryQuery,
} from "../../shared/query";
import {
  selectSelectedSessionId,
  selectSessionHistoryFilter,
  useOperatorUiStore,
} from "../../shared/state";
import type { SessionHistoryEntry, UpstreamAvailability } from "../../shared/types";
import { SearchInput } from "../../shared/ui/Input";
import {
  Badge,
  Button,
  DataTable,
  DisclosurePanel,
  EmptyState,
  InfoTooltip,
  PageHeader,
  Panel,
  Select,
  SummaryStrip,
  SessionsIcon,
} from "../../shared/ui";
import { cx } from "../../shared/ui/cx";
import {
  buildSessionDetailPath,
  buildSessionHistorySearchParams,
  filtersMatch,
  formatDateTime,
  formatDrawdown,
  formatInteger,
  formatSignedCurrency,
  formatStatusLabel,
  getFilterSummary,
  getPageNumber,
  getPageSummary,
  getStatusTone,
  parseSelectedSessionIdSearchParam,
  parseSessionHistorySearchParams,
  SESSION_PAGE_SIZE_OPTIONS,
  SESSION_STATUS_OPTIONS,
  sortSessionHistory,
  toTimelineChartPoints,
  type SessionHistoryViewFilter,
} from "./formatters";

function linkButtonClassName(disabled = false) {
  return cx(
    "focus-ring inline-flex h-11 items-center justify-center rounded-[18px] border px-5 text-sm font-medium transition",
    disabled
      ? "cursor-not-allowed border-white/8 bg-white/[0.04] text-slate-500"
      : "border-white/10 bg-white/[0.05] text-white hover:border-white/16 hover:bg-white/[0.08]",
  );
}

function setStoreFilter(
  filter: SessionHistoryViewFilter,
  actions: {
    setSessionLimit: (limit: number) => void;
    setSessionPage: (page: number) => void;
    setSessionSearch: (query: string) => void;
    setSessionStatus: (status: SessionHistoryViewFilter["status"]) => void;
  },
) {
  actions.setSessionLimit(filter.limit);
  actions.setSessionSearch(filter.q);
  actions.setSessionStatus(filter.status);
  actions.setSessionPage(filter.offset / filter.limit);
}

function getHistoryErrorMessage(error: unknown, coreAvailability: UpstreamAvailability): string {
  if (coreAvailability === "down") {
    return "Core Trading đang không phản hồi nên workspace lịch sử chưa tải được danh sách session đã lưu.";
  }

  if (error instanceof ApiClientError && error.code === "invalid_session_status") {
    return "Bộ lọc status không hợp lệ. Hãy reset filter rồi thử lại.";
  }

  return formatOperatorErrorMessage(error, "Chưa tải được session history.");
}

function SessionHistoryCards({
  buildDetailHref,
  currentSessionId,
  onSelect,
  selectedSessionId,
  sessions,
}: {
  buildDetailHref: (sessionId: string) => string;
  currentSessionId?: string | null;
  onSelect: (sessionId: string) => void;
  selectedSessionId: string | null;
  sessions: SessionHistoryEntry[];
}) {
  if (sessions.length === 0) {
    return (
      <EmptyState
        eyebrow="History queue"
        title="No sessions matched this filter"
        description="Hãy thử từ khóa khác hoặc reset status filter. Session đã lưu vẫn giữ nguyên khi được đọc lại."
        icon={<SessionsIcon className="size-5" />}
      />
    );
  }

  return (
    <div className="grid gap-3">
      {sessions.map((session) => {
        const isSelected = session.session_id === selectedSessionId;

        return (
          <article
            key={session.session_id}
            className={cx(
              "group rounded-[24px] border p-4 transition",
              isSelected
                ? "border-sky-300/28 bg-sky-300/[0.08]"
                : "border-white/8 bg-white/[0.04] hover:border-white/14 hover:bg-white/[0.06]",
            )}
          >
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <button
                type="button"
                onClick={() => onSelect(session.session_id)}
                className="flex-1 text-left"
              >
                <div className="flex flex-wrap items-center gap-3">
                  <Badge tone={getStatusTone(session.status)}>
                    {formatStatusLabel(session.status)}
                  </Badge>
                  {session.session_id === currentSessionId ? (
                    <Badge tone="info">Current session</Badge>
                  ) : null}
                  {isSelected ? <Badge tone="warning">Preview locked</Badge> : null}
                  <span className="font-['IBM_Plex_Mono'] text-[11px] uppercase tracking-[0.18em] text-slate-500">
                    {formatDateTime(session.last_event_at)}
                  </span>
                </div>
                <h3 className="mt-3 text-lg font-medium text-white">{session.session_id}</h3>
                <p className="mt-2 text-sm leading-6 text-slate-400">
                  Bắt đầu lúc {formatDateTime(session.started_at)}. Reset {formatInteger(session.reset_count)} lần.
                </p>
              </button>

              <div className="space-y-3 text-sm text-slate-300 sm:text-right">
                <div className="space-y-1">
                  <div className="text-base font-medium text-white">
                    {formatSignedCurrency(session.total_pnl)}
                  </div>
                  <div>{formatInteger(session.filled_orders)} filled orders</div>
                  <div>Max drawdown {formatDrawdown(session.max_drawdown)}</div>
                </div>
                <Link
                  to={buildDetailHref(session.session_id)}
                  className="inline-flex items-center gap-2 text-xs font-medium uppercase tracking-[0.18em] text-sky-200 hover:text-sky-100"
                >
                  Open detail
                </Link>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function HistoryLoadingState() {
  return (
    <div className="grid gap-3" aria-hidden="true">
      {[0, 1, 2].map((index) => (
        <div
          key={index}
          className="h-[120px] animate-pulse rounded-[24px] border border-white/8 bg-white/[0.04]"
        />
      ))}
    </div>
  );
}

function buildStatusChartPoints(sessions: SessionHistoryEntry[]) {
  const running = sessions.filter((session) => session.status === "running").length;
  const stopped = sessions.filter((session) => session.status === "stopped").length;

  return [
    { label: "Running", value: running, color: "#42d9ba" },
    { label: "Stopped", value: stopped, color: "#f4be51" },
  ];
}

function buildTopPnlPoints(sessions: SessionHistoryEntry[]) {
  return [...sessions]
    .sort((left, right) => right.total_pnl - left.total_pnl)
    .slice(0, 5)
    .map((session) => ({
      label: session.session_id,
      value: session.total_pnl,
    }));
}

function SessionHistoryFiltersForm({
  filter,
  onReset,
  onSubmit,
}: {
  filter: SessionHistoryViewFilter;
  onReset: () => void;
  onSubmit: (nextFilter: SessionHistoryViewFilter) => void;
}) {
  const [draftQuery, setDraftQuery] = useState(filter.q);
  const [draftStatus, setDraftStatus] = useState<SessionHistoryViewFilter["status"]>(
    filter.status,
  );
  const [draftLimit, setDraftLimit] = useState(String(filter.limit));

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    onSubmit({
      limit: Number.parseInt(draftLimit, 10) || filter.limit,
      offset: 0,
      q: draftQuery.trim(),
      status: draftStatus,
    });
  }

  return (
    <Panel
      eyebrow="Filters"
      title="History toolbar"
      description="Tìm theo session ID, lọc theo status và chuyển trang trên danh sách mới nhất."
      actions={
        <div className="flex flex-wrap gap-3">
          <Button tone="ghost" onClick={onReset}>
            Reset filters
          </Button>
          <Button tone="primary" type="submit" form="session-history-filters">
            Apply query
          </Button>
        </div>
      }
    >
      <form
        id="session-history-filters"
        className="grid gap-4 lg:grid-cols-[minmax(0,1.2fr)_220px_180px]"
        onSubmit={handleSubmit}
      >
        <SearchInput
          label="Search session ID"
          placeholder="paper-alpha-live"
          value={draftQuery}
          onChange={(event) => setDraftQuery(event.target.value)}
        />
        <Select
          label="Status"
          value={draftStatus}
          placeholder="All statuses"
          options={SESSION_STATUS_OPTIONS.filter((option) => option.value !== "")}
          onChange={(event) => {
            setDraftStatus(event.target.value as SessionHistoryViewFilter["status"]);
          }}
        />
        <Select
          label="Page size"
          value={draftLimit}
          options={SESSION_PAGE_SIZE_OPTIONS.map((value) => ({
            label: `${value} rows`,
            value: String(value),
          }))}
          onChange={(event) => {
            setDraftLimit(event.target.value);
          }}
        />
      </form>
    </Panel>
  );
}

export function SessionsRouteView() {
  const [searchParams, setSearchParams] = useSearchParams();
  const parsedFilter = parseSessionHistorySearchParams(searchParams);
  const selectedSessionSearchParam = parseSelectedSessionIdSearchParam(searchParams);
  const selectedSessionId = useOperatorUiStore(selectSelectedSessionId);
  const storeFilter = useOperatorUiStore(selectSessionHistoryFilter);
  const setSelectedSessionId = useOperatorUiStore((state) => state.setSelectedSessionId);
  const setSessionLimit = useOperatorUiStore((state) => state.setSessionLimit);
  const setSessionPage = useOperatorUiStore((state) => state.setSessionPage);
  const setSessionSearch = useOperatorUiStore((state) => state.setSessionSearch);
  const setSessionStatus = useOperatorUiStore((state) => state.setSessionStatus);
  const resetSessionHistory = useOperatorUiStore((state) => state.resetSessionHistory);
  const coreHealthQuery = useCoreHealthQuery();
  const coreAvailability = resolveServiceAvailability(coreHealthQuery);
  const currentSessionQuery = useCurrentSessionQuery();
  const historyQuery = useSessionHistoryQuery(parsedFilter);
  const currentSessionId = currentSessionQuery.data?.id ?? null;

  const sessions = sortSessionHistory(historyQuery.data ?? []);
  const selectedPreviewId = resolveSelectedSessionId({
    currentSessionId,
    selectedSessionId: selectedSessionSearchParam ?? selectedSessionId,
    sessions,
  });
  const canonicalSelectedPreviewId =
    !historyQuery.isLoading &&
    (selectedSessionSearchParam !== null ||
      currentSessionQuery.isSuccess ||
      currentSessionQuery.isError)
      ? selectedPreviewId
      : selectedSessionSearchParam;

  const previewReportQuery = usePaperReportQuery(
    selectedPreviewId ? { session_id: selectedPreviewId } : {},
    {
      enabled: Boolean(selectedPreviewId),
    },
  );
  const previewTimelineQuery = usePaperTimelineQuery(
    selectedPreviewId ? { session_id: selectedPreviewId } : {},
    {
      enabled: Boolean(selectedPreviewId),
    },
  );

  const previewTimeline = previewTimelineQuery.data ?? previewReportQuery.data?.timeline ?? [];
  const previewChartOption =
    previewTimeline.length > 0
      ? createTimelineAreaOption(toTimelineChartPoints(previewTimeline))
      : undefined;

  useEffect(() => {
    const normalizedSearch = buildSessionHistorySearchParams(
      parsedFilter,
      canonicalSelectedPreviewId,
    ).toString();
    if (searchParams.toString() === normalizedSearch) {
      return;
    }

    startTransition(() => {
      setSearchParams(
        buildSessionHistorySearchParams(parsedFilter, canonicalSelectedPreviewId),
        { replace: true },
      );
    });
  }, [canonicalSelectedPreviewId, parsedFilter, searchParams, setSearchParams]);

  useEffect(() => {
    if (
      filtersMatch(storeFilter, {
        limit: parsedFilter.limit,
        offset: parsedFilter.offset,
        q: parsedFilter.q,
        status: parsedFilter.status,
      })
    ) {
      return;
    }

    setStoreFilter(parsedFilter, {
      setSessionLimit,
      setSessionPage,
      setSessionSearch,
      setSessionStatus,
    });
  }, [
    parsedFilter,
    setSessionLimit,
    setSessionPage,
    setSessionSearch,
    setSessionStatus,
    storeFilter,
  ]);

  useEffect(() => {
    if (selectedSessionId === selectedPreviewId) {
      return;
    }

    setSelectedSessionId(selectedPreviewId);
  }, [selectedPreviewId, selectedSessionId, setSelectedSessionId]);

  function updateFilter(nextFilter: SessionHistoryViewFilter) {
    setStoreFilter(nextFilter, {
      setSessionLimit,
      setSessionPage,
      setSessionSearch,
      setSessionStatus,
    });

    startTransition(() => {
      setSearchParams(buildSessionHistorySearchParams(nextFilter, selectedPreviewId));
    });
  }

  function handleResetFilters() {
    resetSessionHistory();
    setSelectedSessionId(null);
    startTransition(() => {
      setSearchParams(new URLSearchParams());
    });
  }

  function handleSelectSession(sessionId: string) {
    setSelectedSessionId(sessionId);
    startTransition(() => {
      setSearchParams(buildSessionHistorySearchParams(parsedFilter, sessionId));
    });
  }

  function handlePageChange(direction: "next" | "previous") {
    const nextOffset =
      direction === "next"
        ? parsedFilter.offset + parsedFilter.limit
        : Math.max(parsedFilter.offset - parsedFilter.limit, 0);

    updateFilter({
      ...parsedFilter,
      offset: nextOffset,
    });
  }

  const historyErrorMessage = historyQuery.isError
    ? getHistoryErrorMessage(historyQuery.error, coreAvailability)
    : null;
  const pageNumber = getPageNumber(parsedFilter);
  const pageSummary = getPageSummary(parsedFilter, sessions.length);
  const hasNextPage = sessions.length === parsedFilter.limit;
  const selectedPreviewSession =
    sessions.find((session) => session.session_id === selectedPreviewId) ?? null;
  const runningSessions = sessions.filter((session) => session.status === "running").length;
  const terminalSessions = sessions.length - runningSessions;
  const statusChartOption = sessions.length
    ? createStackedStatusBarOption(buildStatusChartPoints(sessions))
    : undefined;
  const topPnlChartOption = sessions.length
    ? createHorizontalBarOption(buildTopPnlPoints(sessions), {
        formatter: (value) => formatSignedCurrency(value),
      })
    : undefined;
  const previewChartTitle = selectedPreviewId
    ? `Timeline preview for ${selectedPreviewId}`
    : "Selected session timeline";
  const previewEmptyTitle = previewReportQuery.isError
    ? "Selected session preview is unavailable"
    : "No timeline stored for this session";
  const previewEmptyDescription = previewReportQuery.isError
    ? getHistoryErrorMessage(previewReportQuery.error, coreAvailability)
    : previewTimelineQuery.isError
      ? getHistoryErrorMessage(previewTimelineQuery.error, coreAvailability)
      : "Session này chưa lưu timeline snapshot. Anh vẫn có thể mở historical detail để xem report và audit một cách an toàn.";
  const selectedDetailHref = selectedPreviewId
    ? buildSessionDetailPath(selectedPreviewId, {
        filter: parsedFilter,
        selectedSessionId: selectedPreviewId,
      })
    : null;

  return (
    <div className="space-y-6">
      <PageHeader
        variant="compact"
        tone="soft"
        eyebrow="Session History"
        title="Historical review workspace"
        description="Historical-only workspace để đọc lại session đã lưu, khóa preview theo URL, và mở immutable detail mà không chạm vào dashboard realtime."
        actions={
          <>
            <Button
              tone="secondary"
              onClick={() => {
                void historyQuery.refetch();
              }}
              disabled={historyQuery.isFetching}
            >
              {historyQuery.isFetching ? "Refreshing..." : "Refresh history"}
            </Button>
            {selectedDetailHref ? (
              <Link to={selectedDetailHref} className={linkButtonClassName()}>
                Open selected session
              </Link>
            ) : (
              <span className={linkButtonClassName(true)}>Open selected session</span>
            )}
          </>
        }
        meta={[
          { label: "Mode", value: "Historical only" },
          { label: "Selected", value: selectedPreviewId ?? "None" },
          { label: "Filter state", value: getFilterSummary(parsedFilter) },
          { label: "Page", value: `${pageNumber}` },
        ]}
        aside={
          <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone="info" leading={<SessionsIcon className="size-3" />}>
                Historical review route
              </Badge>
              <Badge tone="warning">No SSE</Badge>
            </div>
            <p className="mt-4 text-sm leading-6 text-slate-400">
              Workspace này không mount current-session SSE. Nó chỉ gọi một lần current session để chọn sẵn preview mặc định nếu session đó đã có trong history.
            </p>
            <DisclosurePanel className="mt-4" label="View route notes" contentClassName="space-y-2">
              <p>Preview hiện tại được encode vào URL nên refresh, back-forward và mở detail vẫn giữ nguyên context đọc dở.</p>
              <p>Session history là bề mặt chỉ-đọc. Nếu anh cần dữ liệu live đang đổi theo thời gian, quay lại Dashboard thay vì ở đây.</p>
            </DisclosurePanel>
          </div>
        }
      />

      <SummaryStrip
        items={[
          {
            badge: (
              <Badge tone={selectedPreviewSession ? getStatusTone(selectedPreviewSession.status) : "neutral"}>
                {selectedPreviewSession ? formatStatusLabel(selectedPreviewSession.status) : "Pending"}
              </Badge>
            ),
            label: "Selected",
            meta: selectedPreviewSession
              ? `Updated ${formatDateTime(selectedPreviewSession.last_event_at)}`
              : "Chọn một session đã lưu để khóa preview.",
            tone: selectedPreviewSession ? "accent" : "neutral",
            value: selectedPreviewId ?? "None",
          },
          {
            badge: (
              <Badge
                tone={
                  selectedPreviewSession
                    ? selectedPreviewSession.total_pnl < 0
                      ? "danger"
                      : "success"
                    : "neutral"
                }
              >
                PnL
              </Badge>
            ),
            label: "Selected PnL",
            meta: selectedPreviewSession
              ? `${formatInteger(selectedPreviewSession.filled_orders)} fills · max DD ${formatDrawdown(selectedPreviewSession.max_drawdown)}`
              : "PnL, fills và drawdown sẽ hiện khi preview được khóa.",
            tone:
              selectedPreviewSession && selectedPreviewSession.total_pnl < 0
                ? "danger"
                : selectedPreviewSession
                  ? "success"
                  : "neutral",
            value: selectedPreviewSession ? formatSignedCurrency(selectedPreviewSession.total_pnl) : "-",
          },
          {
            badge: <Badge tone="info">Visible</Badge>,
            label: "Visible sessions",
            meta: `${formatInteger(runningSessions)} running · ${formatInteger(terminalSessions)} terminal`,
            tone: "neutral",
            value: formatInteger(sessions.length),
          },
          {
            badge: <Badge tone={currentSessionId ? "success" : "neutral"}>Current</Badge>,
            label: "Current session",
            meta: currentSessionId
              ? "Chỉ seed preview mặc định nếu session đó đã được lưu."
              : "Chưa có current session để seed selection mặc định.",
            tone: currentSessionId ? "success" : "neutral",
            value: currentSessionId ?? "None",
          },
        ]}
      />

      <SessionHistoryFiltersForm
        key={buildSessionHistorySearchParams(parsedFilter).toString() || "default"}
        filter={parsedFilter}
        onReset={handleResetFilters}
        onSubmit={updateFilter}
      />

      <section className="grid gap-6 xl:grid-cols-[minmax(0,1.15fr)_minmax(340px,0.85fr)]">
        <Panel
          eyebrow="History queue"
          title={
            <span className="inline-flex items-center gap-2">
              Recent sessions
              <InfoTooltip content="Chọn một row ở đây chỉ đổi preview lịch sử. Nó không làm thay đổi dashboard realtime và cũng không mount SSE." />
            </span>
          }
          description="Chọn row để đổi preview lịch sử, không ảnh hưởng live dashboard."
        >
          {historyQuery.isLoading ? (
            <HistoryLoadingState />
          ) : historyErrorMessage ? (
            <EmptyState
              eyebrow="History queue"
              title="Session history is unavailable"
              description={historyErrorMessage}
              icon={<SessionsIcon className="size-5" />}
            />
          ) : (
            <SessionHistoryCards
              buildDetailHref={(sessionId) =>
                buildSessionDetailPath(sessionId, {
                  filter: parsedFilter,
                  selectedSessionId: sessionId,
                })
              }
              currentSessionId={currentSessionId}
              sessions={sessions}
              selectedSessionId={selectedPreviewId}
              onSelect={handleSelectSession}
            />
          )}
        </Panel>

        <div className="grid gap-6">
          <Panel
            eyebrow="Selected preview"
            title={
              selectedPreviewId ? `Preview locked on ${selectedPreviewId}` : "No preview locked"
            }
            description="Preview hiện tại được giữ theo URL để giữ nguyên context khi điều hướng."
            actions={
              selectedDetailHref ? (
                <Link to={selectedDetailHref} className={linkButtonClassName()}>
                  Open preview detail
                </Link>
              ) : undefined
            }
          >
            {selectedPreviewSession ? (
              <div className="grid gap-4">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={getStatusTone(selectedPreviewSession.status)}>
                    {formatStatusLabel(selectedPreviewSession.status)}
                  </Badge>
                  {selectedPreviewSession.session_id === currentSessionId ? (
                    <Badge tone="info">Current session</Badge>
                  ) : null}
                  <Badge tone="warning">URL-backed selection</Badge>
                </div>

                <DisclosurePanel label="View preview notes" contentClassName="space-y-2">
                  <p>Preview này chỉ đọc snapshot lịch sử của session đã chọn. Nó không nhận update live và không thay thế cho dashboard đang theo dõi current session.</p>
                  <p>Khi anh mở detail, cùng selection này sẽ đi theo URL để không mất mạch đọc hiện tại.</p>
                </DisclosurePanel>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      Last event
                    </div>
                    <div className="mt-2 text-sm font-medium text-white">
                      {formatDateTime(selectedPreviewSession.last_event_at)}
                    </div>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      Reset count
                    </div>
                    <div className="mt-2 text-sm font-medium text-white">
                      {formatInteger(selectedPreviewSession.reset_count)}
                    </div>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      Filled orders
                    </div>
                    <div className="mt-2 text-sm font-medium text-white">
                      {formatInteger(selectedPreviewSession.filled_orders)}
                    </div>
                  </div>
                  <div className="rounded-[20px] border border-white/8 bg-white/[0.04] px-4 py-3">
                    <div className="text-[11px] uppercase tracking-[0.16em] text-slate-500">
                      Total PnL
                    </div>
                    <div className="mt-2 text-sm font-medium text-white">
                      {formatSignedCurrency(selectedPreviewSession.total_pnl)}
                    </div>
                  </div>
                </div>
              </div>
            ) : (
              <EmptyState
                eyebrow="Selected preview"
                title="Choose one saved session"
                description="Hãy chọn một session từ queue hoặc table để xem timeline preview trước khi mở immutable detail."
                icon={<SessionsIcon className="size-5" />}
              />
            )}
          </Panel>

          <ChartPanel
            tone="soft"
            eyebrow="Preview"
            title={
              <span className="inline-flex items-center gap-2">
                {previewChartTitle}
                <InfoTooltip content="Chart này chỉ đọc snapshot timeline của session đang chọn. Nó không tự cập nhật theo current session." />
              </span>
            }
            description="Chỉ đọc timeline của historical session đang được chọn."
            chart={{
              emptyDescription: previewEmptyDescription,
              emptyTitle: previewEmptyTitle,
              height: 320,
              loading: previewReportQuery.isLoading || previewTimelineQuery.isLoading,
              option: previewChartOption,
            }}
            footer={
              selectedPreviewSession ? (
                <>
                  <Badge tone={getStatusTone(selectedPreviewSession.status)}>
                    {formatStatusLabel(selectedPreviewSession.status)}
                  </Badge>
                  <span>Total PnL {formatSignedCurrency(selectedPreviewSession.total_pnl)}</span>
                  <span>{formatInteger(selectedPreviewSession.filled_orders)} filled orders</span>
                  <span>Preview encoded in route search params</span>
                </>
              ) : (
                <>
                  <Badge tone="warning">Historical only</Badge>
                  <span>Chọn một session đã lưu để xem timeline preview.</span>
                </>
              )
            }
          />
        </div>
      </section>

      <section className="grid gap-6 xl:grid-cols-2">
        <ChartPanel
          tone="soft"
          eyebrow="Status mix"
          title={
            <span className="inline-flex items-center gap-2">
              Visible session status
              <InfoTooltip content="Biểu đồ này cho biết tỷ lệ running và stopped của đúng tập session đang hiển thị sau khi áp filter hiện tại." />
            </span>
          }
          description="Tỷ lệ status của page hiện tại."
          chart={{
            emptyDescription: "Chưa có session nào trên page hiện tại để tổng hợp status.",
            emptyTitle: "No visible session status",
            height: 220,
            loading: historyQuery.isLoading,
            option: statusChartOption,
          }}
          footer={
            sessions.length ? (
              <>
                <Badge tone="info">{formatInteger(sessions.length)} visible</Badge>
                <span>{getFilterSummary(parsedFilter)}</span>
              </>
            ) : undefined
          }
        />

        <ChartPanel
          tone="soft"
          eyebrow="Outcome"
          title={
            <span className="inline-flex items-center gap-2">
              Top session PnL
              <InfoTooltip content="Biểu đồ này xếp những session có PnL cao nhất trong danh sách đang hiển thị để anh scan nhanh outcome tốt nhất." />
            </span>
          }
          description="Top outcome theo PnL trên tập session đang thấy."
          chart={{
            emptyDescription: "Chưa có session nào để so PnL trên page hiện tại.",
            emptyTitle: "No top session PnL",
            height: 260,
            loading: historyQuery.isLoading,
            option: topPnlChartOption,
          }}
          footer={
            selectedPreviewSession ? (
              <>
                <Badge tone={getStatusTone(selectedPreviewSession.status)}>
                  {formatStatusLabel(selectedPreviewSession.status)}
                </Badge>
                <span>Selected {selectedPreviewSession.session_id}</span>
              </>
            ) : undefined
          }
        />
      </section>

      <Panel
        eyebrow="Table"
        title={
          <span className="inline-flex items-center gap-2">
            Session index
            <InfoTooltip content="Bảng này vẫn dùng đúng limit/offset của contract hiện tại. Row đang được chọn làm preview sẽ được highlight để anh không mất ngữ cảnh." />
          </span>
        }
        description="Bảng lịch sử đầy đủ cho page hiện tại."
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <span>{pageSummary}</span>
            <Button
              tone="ghost"
              size="sm"
              disabled={parsedFilter.offset === 0 || historyQuery.isFetching}
              onClick={() => handlePageChange("previous")}
            >
              Previous
            </Button>
            <Button
              tone="ghost"
              size="sm"
              disabled={!hasNextPage || historyQuery.isFetching}
              onClick={() => handlePageChange("next")}
            >
              Next
            </Button>
          </div>
        }
      >
        <DataTable
          caption="Session history"
          columns={[
            {
              key: "session_id",
              header: "Session ID",
              cell: (row) => (
                <Link
                  to={buildSessionDetailPath(row.session_id, {
                    filter: parsedFilter,
                    selectedSessionId: row.session_id,
                  })}
                  className="font-medium text-white hover:text-sky-200"
                >
                  {row.session_id}
                </Link>
              ),
            },
            {
              key: "status",
              header: "Status",
              cell: (row) => (
                <Badge tone={getStatusTone(row.status)}>{formatStatusLabel(row.status)}</Badge>
              ),
            },
            {
              key: "updated_at",
              header: "Updated",
              cell: (row) => formatDateTime(row.last_event_at),
            },
            {
              key: "filled_orders",
              header: "Filled orders",
              align: "right",
              cell: (row) => formatInteger(row.filled_orders),
            },
            {
              key: "total_pnl",
              header: "PnL",
              align: "right",
              cell: (row) => formatSignedCurrency(row.total_pnl),
            },
            {
              key: "max_drawdown",
              header: "Drawdown",
              align: "right",
              cell: (row) => formatDrawdown(row.max_drawdown),
            },
          ]}
          rows={sessions}
          getRowId={(row) => row.session_id}
          getRowClassName={(row) =>
            row.session_id === selectedPreviewId
              ? "bg-sky-300/[0.06]"
              : row.session_id === currentSessionId
                ? "bg-white/[0.02]"
                : undefined
          }
          emptyTitle="No saved sessions"
          emptyDescription="Các historical session trả về từ /api/paper/sessions sẽ hiện ở đây."
          className={historyQuery.isFetching ? "opacity-70" : undefined}
        />
      </Panel>
    </div>
  );
}
