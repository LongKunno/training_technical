import { QueryClient, useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { simApi } from "../api";
import type {
  CreateExperimentRequest,
  CreateRunRequest,
  ExperimentFilter,
  LeaderboardFilter,
  RunFilter,
} from "../types";
import { invalidateCurrentAfterOperatorMutation, invalidateSessionHistoryQueries } from "./paper";
import { simQueryKeys } from "./keys";

interface QueryHookOptions {
  enabled?: boolean;
  staleTime?: number;
}

function isEnabled(enabled: boolean | undefined): boolean {
  return enabled ?? true;
}

export async function invalidateSimulationQueries(queryClient: QueryClient) {
  await queryClient.invalidateQueries({
    queryKey: simQueryKeys.all(),
    refetchType: "active",
  });
}

export function useSimulationBotsQuery(options: QueryHookOptions = {}) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => simApi.listBots({ signal }),
    queryKey: simQueryKeys.bots(),
    staleTime: options.staleTime,
  });
}

export function useSimulationExperimentsQuery(
  filter: ExperimentFilter = {},
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => simApi.listExperiments(filter, { signal }),
    queryKey: simQueryKeys.experiments(filter),
    staleTime: options.staleTime,
  });
}

export function useSimulationExperimentQuery(
  experimentId: string | null | undefined,
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: Boolean(experimentId) && isEnabled(options.enabled),
    queryFn: ({ signal }) => simApi.getExperiment(experimentId as string, { signal }),
    queryKey: simQueryKeys.experiment(experimentId ?? ""),
    staleTime: options.staleTime,
  });
}

export function useSimulationExperimentSummaryQuery(
  experimentId: string | null | undefined,
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: Boolean(experimentId) && isEnabled(options.enabled),
    queryFn: ({ signal }) => simApi.getExperimentSummary(experimentId as string, { signal }),
    queryKey: simQueryKeys.experimentSummary(experimentId ?? ""),
    staleTime: options.staleTime,
  });
}

export function useSimulationBotQuery(
  botId: string | null | undefined,
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: Boolean(botId) && isEnabled(options.enabled),
    queryFn: ({ signal }) => simApi.getBot(botId as string, { signal }),
    queryKey: simQueryKeys.bot(botId ?? ""),
    staleTime: options.staleTime,
  });
}

export function useSimulationRunsQuery(filter: RunFilter = {}, options: QueryHookOptions = {}) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => simApi.listRuns(filter, { signal }),
    queryKey: simQueryKeys.runs(filter),
    staleTime: options.staleTime,
  });
}

export function useSimulationLeaderboardQuery(
  filter: LeaderboardFilter = {},
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: isEnabled(options.enabled),
    queryFn: ({ signal }) => simApi.listLeaderboard(filter, { signal }),
    queryKey: simQueryKeys.leaderboard(filter),
    staleTime: options.staleTime,
  });
}

export function useSimulationRunQuery(
  runId: string | null | undefined,
  options: QueryHookOptions = {},
) {
  return useQuery({
    enabled: Boolean(runId) && isEnabled(options.enabled),
    queryFn: ({ signal }) => simApi.getRun(runId as string, { signal }),
    queryKey: simQueryKeys.run(runId ?? ""),
    staleTime: options.staleTime,
  });
}

export function useCreateSimulationRunMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateRunRequest) => simApi.createRun(body),
    onSuccess: async () => {
      await Promise.all([
        invalidateSimulationQueries(queryClient),
        invalidateCurrentAfterOperatorMutation(queryClient),
      ]);
    },
  });
}

export function useCreateSimulationExperimentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (body: CreateExperimentRequest) => simApi.createExperiment(body),
    onSuccess: async () => {
      await Promise.all([
        invalidateSimulationQueries(queryClient),
        invalidateCurrentAfterOperatorMutation(queryClient),
      ]);
    },
  });
}

export function useStopSimulationRunMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (runId: string) => simApi.stopRun(runId),
    onSuccess: async () => {
      await Promise.all([
        invalidateSimulationQueries(queryClient),
        invalidateSessionHistoryQueries(queryClient),
        invalidateCurrentAfterOperatorMutation(queryClient),
      ]);
    },
  });
}

export function useStopSimulationExperimentMutation() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (experimentId: string) => simApi.stopExperiment(experimentId),
    onSuccess: async () => {
      await Promise.all([
        invalidateSimulationQueries(queryClient),
        invalidateSessionHistoryQueries(queryClient),
        invalidateCurrentAfterOperatorMutation(queryClient),
      ]);
    },
  });
}
