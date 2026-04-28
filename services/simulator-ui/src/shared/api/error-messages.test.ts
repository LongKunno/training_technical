import { describe, expect, it } from "vitest";

import { formatOperatorErrorMessage } from "./error-messages";
import { ApiClientError } from "./http";

function apiError(status: number, code: string, message: string) {
  return new ApiClientError(status, code, message, {
    error: { code, message },
  });
}

describe("formatOperatorErrorMessage", () => {
  it("hides internal server details from operator copy", () => {
    const message = formatOperatorErrorMessage(
      apiError(500, "internal_error", "panic: database password=secret"),
    );

    expect(message).toContain("internal error");
    expect(message).not.toContain("password=secret");
  });

  it("turns validation errors into actionable input guidance", () => {
    expect(
      formatOperatorErrorMessage(
        apiError(400, "invalid_session_status", "invalid session status"),
      ),
    ).toBe("The request is invalid. Review the input values and try again.");
  });

  it("keeps risk control context visible when the operator can act on it", () => {
    expect(
      formatOperatorErrorMessage(
        apiError(409, "max_order_notional_exceeded", "order notional exceeds limit"),
      ),
    ).toBe("Risk controls rejected this action: order notional exceeds limit");
  });

  it("preserves non-api errors because they are usually client/network failures", () => {
    expect(formatOperatorErrorMessage(new Error("Failed to fetch"))).toBe(
      "Failed to fetch",
    );
  });
});
