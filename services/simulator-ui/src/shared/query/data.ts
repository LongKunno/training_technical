import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { dataApi } from "../api";
import type {
  LatestQuoteQuery,
  PublishQuotesRequest,
  PublishSignalsRequest,
  ReplayQuotesRequest,
  ReplaySignalsRequest,
  StrategySignalsQuery,
} from "../types";
import { dataQueryKeys } from "./keys";
import { invalidateCurrentAfterOperatorMutation } from "./paper";

interface QueryHookOptions {
  enabled?: boolean;
  staleTime?: number;
}

function isEnabled(enabled: boolean | undefined): boolean {
  return enabled ?? true;
}

export function useLatestQuoteQuery(
  query: LatestQuoteQuery,
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: Boolean(query.symbol?.trim()) && isEnabled(options.enabled),
    queryFn: ({ signal }) => dataApi.getLatestQuote(query, { signal }),
    queryKey: dataQueryKeys.latestQuote(query),
    staleTime: options.staleTime,
  });
}

export function useMarketReplayScenariosQuery(options: QueryHookOptions = {}) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => dataApi.listMarketScenarios({ signal }),
    queryKey: dataQueryKeys.marketScenarios(),
    staleTime: options.staleTime,
  });
}

export function useStrategySignalScenariosQuery(options: QueryHookOptions = {}) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => dataApi.listStrategySignalScenarios({ signal }),
    queryKey: dataQueryKeys.strategyScenarios(),
    staleTime: options.staleTime,
  });
}

export function useStrategySignalsQuery(
  query: StrategySignalsQuery = {},
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => dataApi.listStrategySignals(query, { signal }),
    queryKey: dataQueryKeys.strategySignals(query),
    staleTime: options.staleTime,
  });
}

export function usePublishMarketQuotesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: PublishQuotesRequest = {}) => dataApi.publishQuotes(body),
    onSuccess: async () => {
      await invalidateCurrentAfterOperatorMutation(queryClient);
    },
  });
}

export function useReplayMarketQuotesMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ReplayQuotesRequest) => dataApi.replayQuotes(body),
    onSuccess: async () => {
      await invalidateCurrentAfterOperatorMutation(queryClient);
    },
  });
}

export function usePublishStrategySignalsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: PublishSignalsRequest = {}) => dataApi.publishSignals(body),
    onSuccess: async () => {
      await invalidateCurrentAfterOperatorMutation(queryClient);
    },
  });
}

export function useReplayStrategySignalsMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: ReplaySignalsRequest) => dataApi.replaySignals(body),
    onSuccess: async () => {
      await invalidateCurrentAfterOperatorMutation(queryClient);
    },
  });
}

