import {
  type FormEvent,
  startTransition,
  useEffect,
  useState,
} from "react";
import { Link, useSearchParams } from "react-router-dom";

import { ApiClientError } from "../../shared/api/http";
import { ChartPanel, createTimelineAreaOption } from "../../shared/charts";
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
  EmptyState,
  PageHeader,
  Panel,
  Select,
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
    return "Core trading API is unavailable. Historical review depends on /core/health and /core/api/paper/*, so the saved session index cannot load right now.";
  }

  if (error instanceof ApiClientError && error.code === "invalid_session_status") {
    return "The requested status filter is invalid. Reset the filter and try again.";
  }

  if (error instanceof Error) {
    return error.message;
  }

  return "Session history could not be loaded.";
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
        description="Try another search term or reset the status filter. Historical sessions remain immutable once saved."
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
                  Started {formatDateTime(session.started_at)}. Reset count {formatInteger(session.reset_count)}.
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
      description="Search by session ID, filter by session status, and page through the newest saved runs."
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

  const sessions = sortSessionHistory(historyQuery.data ?? []);
  const selectedPreviewId = resolveSelectedSessionId({
    currentSessionId: currentSessionQuery.data?.id ?? null,
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
  const hasNextPage = sessions.length === parsedFilter.limit;
  const selectedPreviewSession =
    sessions.find((session) => session.session_id === selectedPreviewId) ?? null;
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
      : "This session does not have a stored timeline snapshot yet. Historical detail can still render report and audit data safely.";
  const selectedDetailHref = selectedPreviewId
    ? buildSessionDetailPath(selectedPreviewId, {
        filter: parsedFilter,
        selectedSessionId: selectedPreviewId,
      })
    : null;

  return (
    <>
      <PageHeader
        eyebrow="Session History"
        title="Historical review workspace"
        description="Search, page, and compare saved sessions here without contaminating the live operator route. The selected preview is encoded into the URL so refresh, back-forward, and detail navigation keep the same reading context."
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
          { label: "Default sort", value: "Newest first" },
          { label: "Filter state", value: getFilterSummary(parsedFilter) },
          { label: "Page", value: `${pageNumber}` },
          { label: "Selected", value: selectedPreviewId ?? "None" },
        ]}
        aside={
          <div className="rounded-[24px] border border-white/8 bg-white/[0.04] p-5">
            <Badge tone="info" leading={<SessionsIcon className="size-3" />}>
              Historical review route
            </Badge>
            <p className="mt-4 text-sm leading-6 text-slate-400">
              No current-session SSE subscription is mounted here. The only live dependency is a
              one-shot current-session lookup used to choose a default selection when that session
              already exists in history.
            </p>
            <p className="mt-3 text-sm leading-6 text-slate-500">
              Refresh-safe preview: {selectedPreviewId ?? "No session selected yet"}.
            </p>
          </div>
        }
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
          title="Recent sessions"
          description="Selecting a row here only changes the historical preview. The live dashboard remains on its own current-session track."
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
              currentSessionId={currentSessionQuery.data?.id ?? null}
              sessions={sessions}
              selectedSessionId={selectedPreviewId}
              onSelect={handleSelectSession}
            />
          )}
        </Panel>

        <ChartPanel
          tone="soft"
          eyebrow="Preview"
          title={previewChartTitle}
          description="Preview reads only the selected historical session. URL-backed selection means the same context survives refreshes and the dedicated detail route."
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
                <span>Select a saved session to preview timeline context.</span>
              </>
            )
          }
        />
      </section>

      <Panel
        eyebrow="Table"
        title="Session index"
        description="Paging stays contract-compatible with limit and offset. Rows link directly to the dedicated historical detail route."
        actions={
          <div className="flex flex-wrap items-center gap-3 text-sm text-slate-400">
            <span>{getPageSummary(parsedFilter, sessions.length)}</span>
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
          emptyTitle="No saved sessions"
          emptyDescription="Historical sessions returned by /api/paper/sessions render here."
          className={historyQuery.isFetching ? "opacity-70" : undefined}
        />
      </Panel>
    </>
  );
}
