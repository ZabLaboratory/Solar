// @vitest-environment node
import { describe, expect, it } from "vitest";
import { receptionSettings } from "../../src/server/native-server";
describe("Solar-owned shared receiver settings", () => {
  it("seeds disjoint resources and configures Rust state-diff routes without persistence", () => {
    const input = {
      origins: ["http://127.0.0.1:8099"],
      resources: {
        "solar/program": { type: "solar.lsml/1" as const, initial: null },
        "orion/state": {
          type: "orion.state/1" as const,
          initial: { revision: 0 },
        },
      },
    };
    const settings = receptionSettings(input);
    input.resources["orion/state"].initial.revision = 1;
    expect(settings).toMatchObject({
      listen: "127.0.0.1:0",
      resources: { "solar/program": null, "orion/state": { revision: 0 } },
      topology: {
        links: {
          "solar/program": {
            mode: "state",
            destinations: [{ endpoint: "local", target: "solar/program" }],
          },
        },
      },
    });
    expect(settings).not.toHaveProperty("journal");
    expect(settings).not.toHaveProperty("storage");
  });
  it("rejects remote browser origins, undeclared vocabulary and invalid LSML seeds", () => {
    expect(() =>
      receptionSettings({
        origins: ["https://example.com"],
        resources: { scene: { type: "solar.lsml/1", initial: null } },
      }),
    ).toThrow("LSDP_LOCAL_ORIGIN_REQUIRED");
    expect(() =>
      receptionSettings({
        origins: ["http://127.0.0.1:8099"],
        resources: {
          scene: { type: "solar.lsml/1", initial: { lsml: "wrong" } },
        },
      }),
    ).toThrow();
    expect(() =>
      receptionSettings({ origins: ["http://127.0.0.1:8099"], resources: {} }),
    ).toThrow("LSDP_RESOURCES_REQUIRED");
  });
});
