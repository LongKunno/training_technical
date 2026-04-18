import { describe, expect, it } from "vitest";

import {
  buildSessionDetailPath,
  buildSessionHistorySearchParams,
  buildSessionsPath,
  parseSelectedSessionIdSearchParam,
  parseSessionHistorySearchParams,
} from "./formatters";

describe("session history route search params", () => {
  it("parses and rebuilds filters with the selected preview session", () => {
    const searchParams = new URLSearchParams(
      "q=paper-history&status=stopped&limit=50&offset=100&selected=paper-history",
    );

    const filter = parseSessionHistorySearchParams(searchParams);
    const selectedSessionId = parseSelectedSessionIdSearchParam(searchParams);

    expect(filter).toEqual({
      limit: 50,
      offset: 100,
      q: "paper-history",
      status: "stopped",
    });
    expect(selectedSessionId).toBe("paper-history");
    expect(buildSessionHistorySearchParams(filter, selectedSessionId).toString()).toBe(
      "q=paper-history&status=stopped&limit=50&offset=100&selected=paper-history",
    );
  });

  it("includes the preserved workspace state when linking to detail and back", () => {
    const filter = {
      limit: 20,
      offset: 20,
      q: "paper-live",
      status: "running" as const,
    };

    expect(
      buildSessionDetailPath("paper-live", {
        filter,
        selectedSessionId: "paper-live",
      }),
    ).toBe("/sessions/paper-live?q=paper-live&status=running&offset=20&selected=paper-live");
    expect(buildSessionsPath(filter, "paper-live")).toBe(
      "/sessions?q=paper-live&status=running&offset=20&selected=paper-live",
    );
  });
});
