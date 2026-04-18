import { describe, expect, it } from "vitest";

import { buildSearchParams, withSearchParams } from "./query-params";

describe("buildSearchParams", () => {
  it("skips empty values and expands arrays", () => {
    const params = buildSearchParams({
      empty: "",
      limit: 20,
      missing: undefined,
      q: "paper-a",
      status: "running",
      symbols: ["BTCUSDT", null, "ETHUSDT"],
    });

    expect(params.toString()).toBe(
      "limit=20&q=paper-a&status=running&symbols=BTCUSDT&symbols=ETHUSDT",
    );
  });

  it("serializes dates to ISO strings", () => {
    const params = buildSearchParams({
      timestamp: new Date("2026-04-18T03:04:05.000Z"),
    });

    expect(params.get("timestamp")).toBe("2026-04-18T03:04:05.000Z");
  });
});

describe("withSearchParams", () => {
  it("appends query strings only when needed", () => {
    expect(withSearchParams("/api/paper/sessions", { limit: 20, q: "paper-a" })).toBe(
      "/api/paper/sessions?limit=20&q=paper-a",
    );
    expect(withSearchParams("/api/paper/sessions")).toBe("/api/paper/sessions");
  });
});
