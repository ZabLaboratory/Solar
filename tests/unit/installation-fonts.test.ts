// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { InstallationFonts } from "../../src/server/installation-fonts";
import { installationFontBatches } from "../../src/scenes/installation-fonts";
const roots: string[] = [];
const services: InstallationFonts[] = [];
afterEach(async () => {
  for (const service of services.splice(0)) await service.stop();
  for (const root of roots.splice(0)) {
    if (!root.startsWith(join(tmpdir(), "solar-font-test-")))
      throw new Error("test cleanup boundary");
    await rm(root, { recursive: true, force: true });
  }
});
it("persists immutable fonts, reuses unchanged files and admits later installation changes", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-font-test-"));
  roots.push(root);
  const source = join(root, "source"),
    cache = join(root, "cache");
  await mkdir(source);
  await writeFile(join(source, "one.ttf"), Buffer.from("one"));
  await writeFile(join(source, "same.otf"), Buffer.from("one"));
  await writeFile(join(source, "bitmap.fon"), Buffer.from("unsupported"));
  const first = new InstallationFonts(cache);
  await first.prepare([source]);
  expect(first.report).toMatchObject({
    filesRead: 2,
    reused: 0,
    files: 1,
    bytes: 3,
  });
  expect(first.report.unsupported).toHaveLength(1);
  const warm = new InstallationFonts(cache);
  await warm.prepare([source]);
  expect(warm.report).toMatchObject({ filesRead: 0, reused: 2, files: 1 });
  await writeFile(join(source, "new.woff2"), Buffer.from("new"));
  const changed = new InstallationFonts(cache);
  services.push(changed);
  await changed.prepare([source]);
  expect(changed.report).toMatchObject({ filesRead: 1, reused: 2, files: 2 });
  const endpoint = await changed.start(["http://127.0.0.1:8099"]);
  expect((await fetch(endpoint.url)).status).toBe(403);
  expect(
    (
      await fetch(endpoint.url, {
        headers: {
          Origin: "https://untrusted.example",
          Authorization: `Bearer ${endpoint.token}`,
        },
      })
    ).status,
  ).toBe(403);
  const fonts: Uint8Array[] = [];
  for await (const batch of installationFontBatches(endpoint))
    fonts.push(...batch);
  expect(fonts.map((x) => Buffer.from(x).toString()).sort()).toEqual([
    "new",
    "one",
  ]);
  const entries = await (
    await fetch(endpoint.url, {
      headers: { Authorization: `Bearer ${endpoint.token}` },
    })
  ).json();
  await writeFile(join(cache, entries[0].hash), "corrupted");
  await expect(async () => {
    for await (const batch of installationFontBatches(endpoint)) void batch;
  }).rejects.toThrow("INSTALLATION_FONT_ASSET_UNAVAILABLE");
});
it("refuses non-local installation endpoints before fetching", async () => {
  await expect(async () => {
    for await (const batch of installationFontBatches({
      url: "https://example.com/fonts",
      token: "local",
    }))
      void batch;
  }).rejects.toThrow("INSTALLATION_FONT_HOST_REQUIRED");
});
