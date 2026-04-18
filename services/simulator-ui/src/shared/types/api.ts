export type IsoDateTimeString = string;

export type QueryParamPrimitive = string | number | boolean | Date;
export type QueryParamValue =
  | QueryParamPrimitive
  | null
  | undefined
  | Array<QueryParamPrimitive | null | undefined>;

export type QueryParams = Record<string, QueryParamValue>;

export interface ApiRequestOptions {
  signal?: AbortSignal;
  headers?: HeadersInit;
}

export interface ApiErrorPayload {
  error?: {
    code?: string;
    message?: string;
  };
  detail?: unknown;
}

export type TimelineStreamStatus = "idle" | "connecting" | "open" | "error";
