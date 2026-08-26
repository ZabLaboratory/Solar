import { describe, expect, it } from "vitest";
import { checkHostAllowed } from "@lumencast/protocol";

describe("local Canvas image limit", () => {
  it("accepts full-HD hydrated artwork while preserving a finite cap", () => {
    const launchSized = `data:image/png;base64,${"A".repeat(5 * 1024 * 1024)}`;
    const aboveLimit = `data:image/png;base64,${"A".repeat(17 * 1024 * 1024)}`;

    expect(checkHostAllowed(launchSized, undefined)).toEqual({
      allowed: true,
    });
    expect(checkHostAllowed(aboveLimit, undefined)).toEqual({
      allowed: false,
      reason: "asset url is empty or exceeds the length cap",
    });
  });
});
