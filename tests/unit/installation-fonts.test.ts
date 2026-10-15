// @vitest-environment node
import { afterEach, expect, it } from "vitest";
import {
  mkdtemp,
  mkdir,
  writeFile,
  readFile,
  rm,
  open,
} from "node:fs/promises";
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
  const repaired: string[] = [];
  for await (const batch of installationFontBatches(endpoint))
    repaired.push(...batch.map((bytes) => Buffer.from(bytes).toString()));
  expect(repaired.sort()).toEqual(["new", "one"]);
  expect(changed.report.repaired).toBe(1);
});

it.each([
  ["truncated", '{"schema":'],
  [
    "wrong shape",
    JSON.stringify({ schema: "solar.installation-fonts.v1", sources: {} }),
  ],
  [
    "invalid row",
    JSON.stringify({ schema: "solar.installation-fonts.v1", sources: [null] }),
  ],
  ["unknown schema", JSON.stringify({ schema: "future", sources: [] })],
])("reconstructs a %s index from installed sources", async (_name, index) => {
  const root = await mkdtemp(join(tmpdir(), "solar-font-test-"));
  roots.push(root);
  const source = join(root, "source"),
    cache = join(root, "cache");
  await mkdir(source);
  await mkdir(cache);
  await writeFile(join(source, "one.ttf"), "one");
  await writeFile(join(cache, "index.json"), index);
  const recovered = new InstallationFonts(cache);
  await recovered.prepare([source]);
  expect(recovered.report).toMatchObject({
    indexRecovered: true,
    filesRead: 1,
    files: 1,
  });
  const warm = new InstallationFonts(cache);
  await warm.prepare([source]);
  expect(warm.report).toMatchObject({
    indexRecovered: false,
    filesRead: 0,
    reused: 1,
  });
});

it("repairs equal-length corruption on request without hashing fonts during warm prepare", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-font-test-"));
  roots.push(root);
  const source = join(root, "source"),
    cache = join(root, "cache");
  await mkdir(source);
  await writeFile(join(source, "one.ttf"), "one");
  await new InstallationFonts(cache).prepare([source]);
  const { sources } = JSON.parse(
    await readFile(join(cache, "index.json"), "utf8"),
  );
  await writeFile(join(cache, sources[0].hash), "bad");
  const warm = new InstallationFonts(cache);
  services.push(warm);
  await warm.prepare([source]);
  expect(warm.report).toMatchObject({ filesRead: 0, reused: 1, repaired: 0 });
  const endpoint = await warm.start([]);
  const response = await fetch(endpoint.url + "/" + sources[0].hash, {
    headers: { Authorization: `Bearer ${endpoint.token}` },
  });
  expect(response.status).toBe(200);
  expect(await response.text()).toBe("one");
  expect(warm.report.repaired).toBe(1);
});

it("never repairs a font with changed source bytes under the old digest", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-font-test-"));
  roots.push(root);
  const source = join(root, "source"),
    cache = join(root, "cache");
  await mkdir(source);
  const sourcePath = join(source, "one.ttf");
  await writeFile(sourcePath, "one");
  const fonts = new InstallationFonts(cache);
  services.push(fonts);
  await fonts.prepare([source]);
  const { sources } = JSON.parse(
    await readFile(join(cache, "index.json"), "utf8"),
  );
  await writeFile(join(cache, sources[0].hash), "bad");
  await writeFile(sourcePath, "new");
  const endpoint = await fonts.start([]);
  const response = await fetch(endpoint.url + "/" + sources[0].hash, {
    headers: { Authorization: `Bearer ${endpoint.token}` },
  });
  expect(response.status).toBe(500);
  expect(fonts.report.repaired).toBe(0);
});

it("retains genuine index filesystem errors", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-font-test-"));
  roots.push(root);
  const cache = join(root, "cache");
  await mkdir(cache);
  await mkdir(join(cache, "index.json"));
  await expect(new InstallationFonts(cache).prepare([])).rejects.toMatchObject({
    code: "EISDIR",
  });
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

it("reports prepared files, exclusions and capacity without claiming engine registration or disclosing paths", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-font-test-"));
  roots.push(root);
  const source = join(root, "private-source"),
    cache = join(root, "cache");
  await mkdir(source);
  await writeFile(join(source, "one.ttf"), "one");
  await writeFile(join(source, "duplicate.otf"), "one");
  await writeFile(join(source, "old.FON"), "bitmap");
  await writeFile(join(source, "old.fnt"), "bitmap");
  const fonts = new InstallationFonts(cache);
  services.push(fonts);
  expect(fonts.diagnostics()).toMatchObject({
    state: "unprepared",
    preparedFiles: 0,
    failureCode: null,
  });
  await fonts.prepare([source]);
  const endpoint = await fonts.start(["http://127.0.0.1:8099"]);
  const headers = { Authorization: `Bearer ${endpoint.token}` };
  expect((await fetch(endpoint.url + "/report")).status).toBe(403);
  expect(
    (
      await fetch(endpoint.url + "/report", {
        headers: { ...headers, Origin: "https://untrusted.example" },
      })
    ).status,
  ).toBe(403);
  const report = await (
    await fetch(endpoint.url + "/report", { headers })
  ).json();
  expect(report).toMatchObject({
    state: "ready",
    preparedFiles: 1,
    preparedBytes: 3,
    sourceFilesRead: 2,
    unsupportedFiles: 2,
    unsupportedFormats: { ".fon": 1, ".fnt": 1 },
    failureCode: null,
    limits: {
      maxPreparedFiles: 2048,
      maxPreparedBytes: 1024 * 1024 * 1024,
      maxSourceFileBytes: 64 * 1024 * 1024,
    },
  });
  expect(report.supportedFormats).toEqual([
    ".ttf",
    ".otf",
    ".ttc",
    ".woff",
    ".woff2",
  ]);
  expect(JSON.stringify(report)).not.toContain(root);
  expect(report).not.toHaveProperty("registeredFonts");
  expect(
    Array.isArray(await (await fetch(endpoint.url, { headers })).json()),
  ).toBe(true);
  report.supportedFormats.length = 0;
  expect(fonts.diagnostics().supportedFormats).toHaveLength(5);
});

it("keeps a bounded failure diagnostic when one source exceeds the admitted file limit", async () => {
  const root = await mkdtemp(join(tmpdir(), "solar-font-test-"));
  roots.push(root);
  const source = join(root, "large.ttf");
  const file = await open(source, "w");
  try {
    await file.truncate(64 * 1024 * 1024 + 1);
  } finally {
    await file.close();
  }
  const fonts = new InstallationFonts(join(root, "cache"));
  await expect(fonts.prepare([source])).rejects.toThrow(
    "INSTALLATION_FONT_FILE_LIMIT",
  );
  expect(fonts.diagnostics()).toMatchObject({
    state: "failed",
    preparedFiles: 0,
    failureCode: "INSTALLATION_FONT_FILE_LIMIT",
  });
  await rm(source);
  await fonts.prepare([source]);
  expect(fonts.diagnostics()).toMatchObject({
    state: "ready",
    preparedFiles: 0,
    failureCode: null,
  });
});
