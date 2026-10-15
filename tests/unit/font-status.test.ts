// @vitest-environment node
import { mkdtemp, mkdir, open, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, it, vi } from "vitest";
import { SolarReceptionServer } from "../../src/server/native-server";

// Do not enumerate or copy real system fonts in an isolated lifecycle test.
vi.mock("node:os", async () => ({
  ...(await vi.importActual<typeof import("node:os")>("node:os")),
  platform: () => "linux",
}));

it("retains font preparation failure diagnostics after receiver startup cleanup", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-font-status-"));
  if (!root.startsWith(join(tmpdir(), "solar-font-status-")))
    throw new Error("test cleanup boundary");
  const server = new SolarReceptionServer({
    packageRoot: join(root, "package"),
    binaryPath: join(root, "must-not-spawn"),
    origins: ["http://127.0.0.1:8099"],
    resources: { scene: { type: "solar.lsml/1", initial: null } },
    probeIntervalMs: 0,
  });
  try {
    vi.stubEnv("LOCALAPPDATA", join(root, "data"));
    await mkdir(join(root, "package", "fonts"), { recursive: true });
    const file = await open(join(root, "package", "fonts", "large.ttf"), "w");
    try {
      await file.truncate(64 * 1024 * 1024 + 1);
    } finally {
      await file.close();
    }
    expect(server.status()).not.toHaveProperty("fonts");
    await expect(server.start()).rejects.toThrow(
      "INSTALLATION_FONT_FILE_LIMIT",
    );
    expect(server.status()).toMatchObject({
      ready: false,
      pid: null,
      fonts: {
        state: "failed",
        preparedFiles: 0,
        failureCode: "INSTALLATION_FONT_FILE_LIMIT",
      },
    });
    const snapshot = server.status().fonts!;
    snapshot.state = "ready";
    snapshot.limits.maxPreparedFiles = 0;
    expect(server.status().fonts?.state).toBe("failed");
    expect(server.status().fonts?.limits.maxPreparedFiles).toBe(2048);
    await server.stop();
    expect(server.status().fonts?.failureCode).toBe(
      "INSTALLATION_FONT_FILE_LIMIT",
    );
    expect(JSON.stringify(server.status())).not.toContain(root);
  } finally {
    await server.stop();
    vi.unstubAllEnvs();
    await rm(root, { recursive: true, force: true });
  }
});
