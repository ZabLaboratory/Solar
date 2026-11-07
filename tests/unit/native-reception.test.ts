// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import {
  receptionSettings,
  SolarReceptionServer,
} from "../../src/server/native-server";
describe("Solar-owned shared receiver settings", () => {
  it("admits the composition resource declared by the Prism native host", () => {
    const initial = {
      schema: "solar.native-composition.state/1",
      producers: {},
      graphs: {},
    };
    const settings = receptionSettings({
      origins: ["http://127.0.0.1:8099"],
      resources: {
        "solar/composition": {
          type: "solar.native-composition/1",
          initial,
        },
      },
    });
    expect(settings).toMatchObject({
      resources: { "solar/composition": initial },
      topology: {
        links: {
          "solar/composition": {
            type: "solar.native-composition/1",
            mode: "state",
            destinations: [{ endpoint: "local", target: "solar/composition" }],
          },
        },
        inlets: {
          "solar/composition": {
            type: "solar.native-composition/1",
            mode: "state",
          },
        },
      },
    });
  });
  it("rejects arbitrary types, renamed composition ports and malformed composition seeds", () => {
    const origins = ["http://127.0.0.1:8099"];
    const seed = {
      schema: "solar.native-composition.state/1",
      producers: {},
      graphs: {},
    };
    expect(() =>
      receptionSettings({
        origins,
        resources: {
          "solar/composition": {
            type: "other.state/1" as "orion.state/1",
            initial: seed,
          },
        },
      }),
    ).toThrow("LSDP_RESOURCE_INVALID");
    expect(() =>
      receptionSettings({
        origins,
        resources: {
          "solar/elsewhere": {
            type: "solar.native-composition/1",
            initial: seed,
          },
        },
      }),
    ).toThrow("LSDP_RESOURCE_INVALID");
    for (const initial of [
      null,
      { ...seed, schema: "wrong/1" },
      { ...seed, unexpected: true },
      { ...seed, producers: { C: "foreign" } },
      {
        ...seed,
        producers: { A: "host-a" },
        graphs: {
          A: {
            schema: "solar.native-composition.plan/2",
            producer_id: "host-b",
            planHash: "sha256:different",
            coverageSurfaces: [],
          },
        },
      },
    ]) {
      expect(() =>
        receptionSettings({
          origins,
          resources: {
            "solar/composition": {
              type: "solar.native-composition/1",
              initial,
            },
          },
        }),
      ).toThrow(/NATIVE_COMPOSITION_/);
    }
  });
  it("rejects a malformed full composition replacement before native exchange", async () => {
    const server = new SolarReceptionServer({
      origins: ["http://127.0.0.1:8099"],
      resources: {
        "solar/composition": {
          type: "solar.native-composition/1",
          initial: {
            schema: "solar.native-composition.state/1",
            producers: {},
            graphs: {},
          },
        },
      },
    });
    await expect(
      server.replace("solar/composition", {
        schema: "solar.native-composition.state/1",
        producers: { A: "host-a" },
        graphs: { A: { schema: "unsupported/1", producer_id: "host-a" } },
      }),
    ).rejects.toThrow("NATIVE_COMPOSITION_GRAPH_INVALID");
    expect(server.status().ready).toBe(false);
  });
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

describe("current native reception reads", () => {
  const target = "solar/composition";
  const seed = {
    schema: "solar.native-composition.state/1",
    producers: {},
    graphs: {},
  };
  const hash = "tree-sha256:" + "a".repeat(64);
  const setup = () => {
    const server = new SolarReceptionServer({
      origins: ["http://127.0.0.1:8099"],
      resources: {
        [target]: { type: "solar.native-composition/1", initial: seed },
      },
    });
    const transaction = vi.fn();
    const lifetime = new AbortController();
    Object.assign(server, {
      connection: {},
      abort: lifetime,
      currentReader: { ready: Promise.resolve(), transaction },
    });
    const full = vi
      .spyOn(server, "read")
      .mockResolvedValue({ state: seed, stateHash: hash });
    return { server, transaction, full, lifetime };
  };
  it("reads the state and hash of the same native revision", async () => {
    const { server, transaction, full } = setup();
    transaction.mockResolvedValue({ target, state: seed, stateHash: hash });
    expect(await server.readCurrent(target)).toEqual({
      state: seed,
      stateHash: hash,
    });
    expect(transaction).toHaveBeenCalledWith(
      { kind: "get", target },
      { signal: expect.any(AbortSignal) },
    );
    expect(full).not.toHaveBeenCalled();
  });
  it("streams oversized snapshots and propagates other native failures", async () => {
    const { server, transaction, full } = setup();
    transaction.mockRejectedValueOnce(
      Object.assign(new Error("too large"), { code: "SNAPSHOT_LIMIT" }),
    );
    await expect(server.readCurrent(target)).resolves.toEqual({
      state: seed,
      stateHash: hash,
    });
    transaction.mockRejectedValueOnce(new Error("TARGET_UNKNOWN"));
    await expect(server.readCurrent(target)).rejects.toThrow("TARGET_UNKNOWN");
    expect(full).toHaveBeenCalledTimes(1);
  });
  it("rejects a wrong target, a missing hash and an answer from a stopped receiver", async () => {
    const { server, transaction, lifetime } = setup();
    transaction
      .mockResolvedValueOnce({ target: "other", state: seed, stateHash: hash })
      .mockResolvedValueOnce({ target, state: seed })
      .mockImplementationOnce(async () => {
        lifetime.abort();
        return { target, state: seed, stateHash: hash };
      });
    await expect(server.readCurrent(target)).rejects.toThrow(
      "LSDP_SNAPSHOT_INVALID",
    );
    await expect(server.readCurrent(target)).rejects.toThrow(
      "LSDP_SNAPSHOT_INVALID",
    );
    await expect(server.readCurrent(target)).rejects.toThrow();
  });
});
