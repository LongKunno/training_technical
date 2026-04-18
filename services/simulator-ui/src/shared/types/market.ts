import type { IsoDateTimeString, QueryParams } from "./api";

export interface PriceTick {
  symbol: string;
  price: number;
  source: string;
  timestamp: IsoDateTimeString;
  scenario?: string;
}

export interface LatestQuoteQuery extends QueryParams {
  symbol: string;
  scenario?: string;
}

export interface PublishQuotesRequest {
  scenario?: string;
  symbols?: string[];
  transport?: string;
}

export interface ReplayQuotesRequest {
  scenario?: string;
  symbols?: string[];
  speed_multiplier: number;
  transport?: string;
}

export interface LatestQuoteResponse {
  quote: PriceTick;
}

export interface MarketScenariosResponse {
  scenarios: string[];
}

export interface PublishQuotesResponse {
  scenario: string;
  published_count: number;
  symbols: string[];
  transport: string;
  transports: string[];
}

export interface ReplayQuotesResponse {
  scenario: string;
  published_count: number;
  symbols: string[];
  speed_multiplier: number;
  transport: string;
}
