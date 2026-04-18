import type { QueryParamPrimitive, QueryParams } from "../types";

function appendValue(params: URLSearchParams, key: string, value: QueryParamPrimitive) {
  const normalizedValue = value instanceof Date ? value.toISOString() : String(value);
  params.append(key, normalizedValue);
}

export function buildSearchParams(query: QueryParams = {}): URLSearchParams {
  const params = new URLSearchParams();

  Object.entries(query).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item === undefined || item === null) {
          return;
        }
        appendValue(params, key, item);
      });
      return;
    }

    if (typeof value === "string" && value.trim() === "") {
      return;
    }

    appendValue(params, key, value);
  });

  return params;
}

export function withSearchParams(path: string, query?: QueryParams): string {
  const params = buildSearchParams(query);
  const queryString = params.toString();

  return queryString ? `${path}?${queryString}` : path;
}

