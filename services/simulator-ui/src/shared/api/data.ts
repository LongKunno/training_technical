import type {
  ApiRequestOptions,
  LatestQuoteQuery,
  LatestQuoteResponse,
  MarketScenariosResponse,
  PublishQuotesRequest,
  PublishQuotesResponse,
  PublishSignalsRequest,
  PublishSignalsResponse,
  ReplayQuotesRequest,
  ReplayQuotesResponse,
  ReplaySignalsRequest,
  ReplaySignalsResponse,
  StrategyScenariosResponse,
  StrategySignalsQuery,
  StrategySignalsResponse,
} from "../types";
import { createJsonApiClient } from "./http";

const dataClient = createJsonApiClient("/data");

export const dataApi = {
  getLatestQuote(query: LatestQuoteQuery, options?: ApiRequestOptions) {
    return dataClient
      .get<LatestQuoteResponse>("/api/data/market/quotes/latest", query, options)
      .then((payload) => payload.quote);
  },

  listMarketScenarios(options?: ApiRequestOptions) {
    return dataClient
      .get<MarketScenariosResponse>("/api/data/market/quotes/replay/scenarios", undefined, options)
      .then((payload) => payload.scenarios);
  },

  publishQuotes(body: PublishQuotesRequest = {}, options?: ApiRequestOptions) {
    return dataClient.post<PublishQuotesResponse, PublishQuotesRequest>(
      "/api/data/market/quotes/publish",
      body,
      options,
    );
  },

  replayQuotes(body: ReplayQuotesRequest, options?: ApiRequestOptions) {
    return dataClient.post<ReplayQuotesResponse, ReplayQuotesRequest>(
      "/api/data/market/quotes/replay",
      body,
      options,
    );
  },

  listStrategySignalScenarios(options?: ApiRequestOptions) {
    return dataClient
      .get<StrategyScenariosResponse>("/api/data/strategy/signals/scenarios", undefined, options)
      .then((payload) => payload.scenarios);
  },

  listStrategySignals(query: StrategySignalsQuery = {}, options?: ApiRequestOptions) {
    return dataClient
      .get<StrategySignalsResponse>("/api/data/strategy/signals", query, options)
      .then((payload) => payload.signals);
  },

  publishSignals(body: PublishSignalsRequest = {}, options?: ApiRequestOptions) {
    return dataClient.post<PublishSignalsResponse, PublishSignalsRequest>(
      "/api/data/strategy/signals/publish",
      body,
      options,
    );
  },

  replaySignals(body: ReplaySignalsRequest, options?: ApiRequestOptions) {
    return dataClient.post<ReplaySignalsResponse, ReplaySignalsRequest>(
      "/api/data/strategy/signals/replay",
      body,
      options,
    );
  },
};

