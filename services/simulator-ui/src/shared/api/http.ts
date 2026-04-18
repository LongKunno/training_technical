import { withSearchParams } from "../lib";
import type { ApiErrorPayload, ApiRequestOptions, QueryParams } from "../types";

type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

interface JsonRequestOptions<TBody = unknown> extends ApiRequestOptions {
  body?: TBody;
  method?: HttpMethod;
  query?: QueryParams;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function stringifyDetail(detail: unknown): string {
  if (typeof detail === "string") {
    return detail;
  }

  if (Array.isArray(detail)) {
    return detail.map((item) => stringifyDetail(item)).filter(Boolean).join(", ");
  }

  if (isRecord(detail)) {
    if (typeof detail.message === "string") {
      return detail.message;
    }

    try {
      return JSON.stringify(detail);
    } catch (error) {
      return (error as Error).message;
    }
  }

  return "";
}

function extractError(status: number, payload: unknown): { code: string; message: string } {
  if (isRecord(payload)) {
    const normalizedPayload = payload as ApiErrorPayload;
    if (isRecord(normalizedPayload.error)) {
      const code =
        typeof normalizedPayload.error.code === "string"
          ? normalizedPayload.error.code
          : `http_${status}`;
      const message =
        typeof normalizedPayload.error.message === "string"
          ? normalizedPayload.error.message
          : `request failed (${status})`;
      return { code, message };
    }

    if ("detail" in normalizedPayload) {
      const message = stringifyDetail(normalizedPayload.detail) || `request failed (${status})`;
      return { code: `http_${status}`, message };
    }
  }

  if (typeof payload === "string" && payload.trim() !== "") {
    return { code: `http_${status}`, message: payload };
  }

  return { code: `http_${status}`, message: `request failed (${status})` };
}

async function parsePayload(response: Response): Promise<unknown> {
  const rawPayload = await response.text();
  if (rawPayload === "") {
    return null;
  }

  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return JSON.parse(rawPayload);
  }

  try {
    return JSON.parse(rawPayload);
  } catch {
    return rawPayload;
  }
}

export class ApiClientError extends Error {
  readonly code: string;
  readonly payload: unknown;
  readonly status: number;

  constructor(status: number, code: string, message: string, payload: unknown) {
    super(message);
    this.name = "ApiClientError";
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

export function createJsonApiClient(basePath: string, fetchImpl: typeof fetch = fetch) {
  async function request<TResponse, TBody = unknown>(
    path: string,
    options: JsonRequestOptions<TBody> = {},
  ): Promise<TResponse> {
    const { body, headers, method = "GET", query, signal } = options;
    const requestHeaders = new Headers(headers);
    if (body !== undefined && !requestHeaders.has("Content-Type")) {
      requestHeaders.set("Content-Type", "application/json");
    }

    const response = await fetchImpl(`${basePath}${withSearchParams(path, query)}`, {
      body: body === undefined ? undefined : JSON.stringify(body),
      headers: requestHeaders,
      method,
      signal,
    });

    const payload = await parsePayload(response);

    if (!response.ok) {
      const error = extractError(response.status, payload);
      throw new ApiClientError(response.status, error.code, error.message, payload);
    }

    return payload as TResponse;
  }

  function get<TResponse, TQuery extends object | undefined = QueryParams>(
    path: string,
    query?: TQuery,
    options?: ApiRequestOptions,
  ) {
    return request<TResponse>(path, {
      ...options,
      method: "GET",
      query: query as QueryParams | undefined,
    });
  }

  function post<TResponse, TBody = unknown>(
    path: string,
    body?: TBody,
    options?: ApiRequestOptions,
  ) {
    return request<TResponse, TBody>(path, {
      ...options,
      body,
      method: "POST",
    });
  }

  return {
    get,
    post,
    request,
  };
}
