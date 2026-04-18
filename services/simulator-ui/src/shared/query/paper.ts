import { useEffect } from "react";
import {
  QueryClient,
  useMutation,
  useQuery,
  useQueryClient,
} from "@tanstack/react-query";

import { coreApi } from "../api";
import { appendTimelinePoint, attachTimelineToReport, getReportTimeline } from "../lib";
import {
  selectSessionHistoryFilter,
  useOperatorUiStore,
} from "../state";
import type {
  CurrentSessionSnapshot,
  CurrentSessionSnapshotQuery,
  ManualSignalRequest,
  PaperAuditQuery,
  PaperOrderFilter,
  PaperReportQuery,
  PaperTimelineQuery,
  PlacePaperOrderRequest,
  SelectedSessionDetailQuery,
  SessionHistoryFilter,
  SessionReport,
  SessionTimelinePoint,
  StartSessionRequest,
} from "../types";
import { paperQueryKeys } from "./keys";

interface QueryHookOptions {
  enabled?: boolean;
  staleTime?: number;
}

function isEnabled(enabled: boolean | undefined): boolean {
  return enabled ?? true;
}

export async function invalidateSessionHistoryQueries(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: paperQueryKeys.sessions(),
    refetchType: "active",
  });
}

export async function invalidateCurrentRealtimeQueries(queryClient: QueryClient) {
  await Promise.all([
    queryClient.invalidateQueries({
      queryKey: paperQueryKeys.session(),
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: paperQueryKeys.portfolio(),
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: paperQueryKeys.positions(),
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: paperQueryKeys.report(),
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: paperQueryKeys.auditRoot(),
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: paperQueryKeys.timeline(),
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: paperQueryKeys.ordersRoot(),
      refetchType: "active",
    }),
    queryClient.invalidateQueries({
      queryKey: paperQueryKeys.currentSnapshots(),
      refetchType: "active",
    }),
  ]);
}

export async function invalidateCurrentAfterOperatorMutation(queryClient: QueryClient) {
  await Promise.all([
    invalidateCurrentRealtimeQueries(queryClient),
    invalidateSessionHistoryQueries(queryClient),
  ]);
}

export function applyCurrentTimelinePoint(queryClient: QueryClient, point: SessionTimelinePoint) {
  queryClient.setQueryData<SessionTimelinePoint[]>(
    paperQueryKeys.timeline(),
    (currentTimeline = []) => appendTimelinePoint(currentTimeline, point),
  );

  queryClient.setQueryData<SessionReport | undefined>(
    paperQueryKeys.report(),
    (currentReport) => {
      if (!currentReport) {
        return currentReport;
      }

      const nextTimeline = appendTimelinePoint(getReportTimeline(currentReport), point);
      return attachTimelineToReport(currentReport, nextTimeline);
    },
  );

  queryClient.setQueriesData<CurrentSessionSnapshot | undefined>(
    { queryKey: paperQueryKeys.currentSnapshots() },
    (snapshot) => {
      if (!snapshot) {
        return snapshot;
      }

      const nextTimeline = appendTimelinePoint(snapshot.timeline, point);
      return {
        ...snapshot,
        timeline: nextTimeline,
        report: attachTimelineToReport(snapshot.report, nextTimeline),
      };
    },
  );
}

export function usePaperAccountQuery(options: QueryHookOptions = {}) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => coreApi.getAccount({ signal }),
    queryKey: paperQueryKeys.account(),
    staleTime: options.staleTime,
  });
}

export function usePaperPortfolioQuery(options: QueryHookOptions = {}) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => coreApi.getPortfolio({ signal }),
    queryKey: paperQueryKeys.portfolio(),
    staleTime: options.staleTime,
  });
}

export function usePaperPositionsQuery(options: QueryHookOptions = {}) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => coreApi.getPositions({ signal }),
    queryKey: paperQueryKeys.positions(),
    staleTime: options.staleTime,
  });
}

export function usePaperRulesQuery(options: QueryHookOptions = {}) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => coreApi.getRules({ signal }),
    queryKey: paperQueryKeys.rules(),
    staleTime: options.staleTime,
  });
}

export function useCurrentSessionQuery(options: QueryHookOptions = {}) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => coreApi.getCurrentSession({ signal }),
    queryKey: paperQueryKeys.session(),
    staleTime: options.staleTime,
  });
}

export function useSessionHistoryQuery(
  filter: SessionHistoryFilter = {},
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => coreApi.listSessions(filter, { signal }),
    queryKey: paperQueryKeys.sessionHistory(filter),
    staleTime: options.staleTime,
  });
}

export function useOperatorSessionHistoryQuery(options: QueryHookOptions = {}) {
  const filter = useOperatorUiStore(selectSessionHistoryFilter);
  const syncSelectedSession = useOperatorUiStore((state) => state.syncSelectedSession);
  const currentSessionQuery = useCurrentSessionQuery(options);
  const sessionHistoryQuery = useSessionHistoryQuery(filter, options);

  useEffect(() => {
    if (!sessionHistoryQuery.data) {
      return;
    }

    syncSelectedSession(sessionHistoryQuery.data, currentSessionQuery.data?.id ?? null);
  }, [currentSessionQuery.data?.id, sessionHistoryQuery.data, syncSelectedSession]);

  return sessionHistoryQuery;
}

export function usePaperAuditQuery(
  query: PaperAuditQuery = {},
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => coreApi.listAudit(query, { signal }),
    queryKey: paperQueryKeys.audit(query),
    staleTime: options.staleTime,
  });
}

export function usePaperReportQuery(
  query: PaperReportQuery = {},
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => coreApi.getReport(query, { signal }),
    queryKey: paperQueryKeys.report(query),
    staleTime: options.staleTime,
  });
}

export function usePaperTimelineQuery(
  query: PaperTimelineQuery = {},
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => coreApi.getTimeline(query, { signal }),
    queryKey: paperQueryKeys.timeline(query),
    staleTime: options.staleTime,
  });
}

export function usePaperOrdersQuery(
  filter: PaperOrderFilter = {},
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => coreApi.listOrders(filter, { signal }),
    queryKey: paperQueryKeys.orders(filter),
    staleTime: options.staleTime,
  });
}

export function useCurrentSessionSnapshotQuery(
  query: CurrentSessionSnapshotQuery = {},
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => coreApi.getCurrentSessionSnapshot(query, { signal }),
    queryKey: paperQueryKeys.currentSnapshot(query),
    staleTime: options.staleTime,
  });
}

export function useSelectedSessionDetailQuery(
  sessionId: string | null | undefined,
  query: SelectedSessionDetailQuery = {},
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: Boolean(sessionId) && isEnabled(options.enabled),
    queryFn: ({ signal }) => coreApi.getSelectedSessionDetail(sessionId as string, query, { signal }),
    queryKey: paperQueryKeys.sessionDetail(sessionId ?? "", query),
    staleTime: options.staleTime,
  });
}

export function useStartSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: StartSessionRequest = {}) => coreApi.startSession(body),
    onSuccess: async () => {
      await invalidateCurrentAfterOperatorMutation(queryClient);
    },
  });
}

export function useResetSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => coreApi.resetSession(),
    onSuccess: async () => {
      await invalidateCurrentAfterOperatorMutation(queryClient);
    },
  });
}

export function useStopSessionMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: () => coreApi.stopSession(),
    onSuccess: async () => {
      await invalidateCurrentAfterOperatorMutation(queryClient);
    },
  });
}

export function usePlacePaperOrderMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: PlacePaperOrderRequest) => coreApi.placeOrder(body),
    onSuccess: async () => {
      await invalidateCurrentAfterOperatorMutation(queryClient);
    },
  });
}

export function useSendManualSignalMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ManualSignalRequest) => coreApi.sendManualSignal(body),
    onSuccess: async () => {
      await invalidateCurrentAfterOperatorMutation(queryClient);
    },
  });
}
