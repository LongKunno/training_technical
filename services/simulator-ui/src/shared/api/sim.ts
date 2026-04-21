import type {
  ApiRequestOptions,
  BotsResponse,
  BotResponse,
  CreateExperimentRequest,
  CreateRunRequest,
  ExperimentFilter,
  ExperimentResponse,
  ExperimentsResponse,
  ExperimentSummaryResponse,
  LeaderboardFilter,
  LeaderboardResponse,
  RunFilter,
  RunResponse,
  RunsResponse,
} from "../types";
import { createJsonApiClient } from "./http";

const simClient = createJsonApiClient("/core");

export const simApi = {
  listBots(options?: ApiRequestOptions) {
    return simClient.get<BotsResponse>("/api/sim/bots", undefined, options).then((payload) => payload.bots);
  },

  getBot(botId: string, options?: ApiRequestOptions) {
    return simClient.get<BotResponse>(`/api/sim/bots/${encodeURIComponent(botId)}`, undefined, options).then((payload) => payload.bot);
  },

  listExperiments(query: ExperimentFilter = {}, options?: ApiRequestOptions) {
    return simClient
      .get<ExperimentsResponse>("/api/sim/experiments", query, options)
      .then((payload) => payload.experiments);
  },

  getExperiment(experimentId: string, options?: ApiRequestOptions) {
    return simClient
      .get<ExperimentResponse>(`/api/sim/experiments/${encodeURIComponent(experimentId)}`, undefined, options)
      .then((payload) => payload.experiment);
  },

  createExperiment(body: CreateExperimentRequest, options?: ApiRequestOptions) {
    return simClient
      .post<ExperimentResponse, CreateExperimentRequest>("/api/sim/experiments", body, options)
      .then((payload) => payload.experiment);
  },

  stopExperiment(experimentId: string, options?: ApiRequestOptions) {
    return simClient
      .post<ExperimentResponse, Record<string, never>>(`/api/sim/experiments/${encodeURIComponent(experimentId)}/stop`, {}, options)
      .then((payload) => payload.experiment);
  },

  getExperimentSummary(experimentId: string, options?: ApiRequestOptions) {
    return simClient
      .get<ExperimentSummaryResponse>(`/api/sim/experiments/${encodeURIComponent(experimentId)}/summary`, undefined, options)
      .then((payload) => payload.rows);
  },

  listRuns(query: RunFilter = {}, options?: ApiRequestOptions) {
    return simClient.get<RunsResponse>("/api/sim/runs", query, options).then((payload) => payload.runs);
  },

  listLeaderboard(query: LeaderboardFilter = {}, options?: ApiRequestOptions) {
    return simClient
      .get<LeaderboardResponse>("/api/sim/leaderboard", query, options)
      .then((payload) => payload.rows);
  },

  getRun(runId: string, options?: ApiRequestOptions) {
    return simClient.get<RunResponse>(`/api/sim/runs/${encodeURIComponent(runId)}`, undefined, options).then((payload) => payload.run);
  },

  createRun(body: CreateRunRequest, options?: ApiRequestOptions) {
    return simClient.post<RunResponse, CreateRunRequest>("/api/sim/runs", body, options).then((payload) => payload.run);
  },

  stopRun(runId: string, options?: ApiRequestOptions) {
    return simClient
      .post<RunResponse, Record<string, never>>(`/api/sim/runs/${encodeURIComponent(runId)}/stop`, {}, options)
      .then((payload) => payload.run);
  },
};
