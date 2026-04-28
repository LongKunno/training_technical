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

export interface ScenarioCatalogEntry {
  scenario_id: string;
  name: string;
  description: string;
  symbols: string[];
  tick_count: number;
  started_at: IsoDateTimeString;
  ended_at: IsoDateTimeString;
  tags: string[];
  microstructure_profile: MarketMicrostructureProfile;
}

export interface MarketMicrostructureProfile {
  signal_latency_ticks: number;
  spread_bps: number;
  max_fill_notional_per_tick: number;
  liquidity_curve?: LiquidityCurvePoint[];
  queue_priority?: number;
  market_impact_bps_per_10k?: number;
  cancel_after_ticks?: number;
}

export interface LiquidityCurvePoint {
  max_notional: number;
  fill_ratio: number;
}

export interface ScenarioCatalogResponse {
  scenarios: ScenarioCatalogEntry[];
}

export interface ScenarioDetailResponse {
  scenario: ScenarioCatalogEntry;
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
