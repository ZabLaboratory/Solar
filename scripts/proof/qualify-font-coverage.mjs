/** Read-only Windows/source-cache inventory. This does not register fonts in Vision. */
import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import { dirname, extname, join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { InstallationFonts } from "../../src/server/installation-fonts.ts";
import { windowsRegisteredFonts } from "../../src/server/windows-fonts.ts";

const { values } = parseArgs({
  options: {
    "installed-root": { type: "string" },
    "cache-index": { type: "string" },
    report: { type: "string" },
  },
});
if (process.platform !== "win32") throw new Error("Windows inventory required");
for (const key of ["installed-root", "cache-index", "report"])
  if (!values[key]) throw new Error(`Missing --${key}`);
const installed = resolve(values["installed-root"]);
const indexPath = resolve(values["cache-index"]);
const cache = dirname(indexPath);
const reportPath = resolve(values.report);
const contract = new InstallationFonts(cache).diagnostics();
const supported = new Set(contract.supportedFormats);
const index = JSON.parse(await readFile(indexPath, "utf8"));
if (
  index.schema !== "solar.installation-fonts.v1" ||
  !Array.isArray(index.sources)
)
  throw new Error("Invalid installation index");
if (
  index.sources.some(
    (row) =>
      !row ||
      typeof row.path !== "string" ||
      !/^[a-f0-9]{64}$/.test(row.hash) ||
      !Number.isSafeInteger(row.size) ||
      row.size <= 0 ||
      row.size > contract.limits.maxSourceFileBytes,
  )
)
  throw new Error("Invalid installation index entry");
const windows = process.env.WINDIR ?? "C:/Windows";
const local = process.env.LOCALAPPDATA;
if (!local) throw new Error("LOCALAPPDATA required");
const candidates = new Map();
const roots = [
  ["packaged-host", join(installed, "host", "fonts")],
  ["packaged-fonts", join(installed, "fonts")],
  ["windows-system", join(windows, "Fonts")],
  ["windows-user", join(local, "Microsoft", "Windows", "Fonts")],
];
const scans = [];
for (const [group, root] of roots) {
  let names;
  try {
    names = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    scans.push({ group, exists: false, files: 0 });
    continue;
  }
  const files = names.filter((entry) => entry.isFile());
  scans.push({ group, exists: true, files: files.length });
  for (const entry of files) {
    const path = join(root, entry.name);
    candidates.set(path.toLowerCase(), { path, group });
  }
}
const registered = await windowsRegisteredFonts(windows);
scans.push({ group: "windows-registry", entries: registered.length });
for (const path of registered)
  if (!candidates.has(path.toLowerCase()))
    candidates.set(path.toLowerCase(), { path, group: "windows-registry" });
const sha = (bytes) => createHash("sha256").update(bytes).digest("hex");
const indexed = new Map(
  index.sources.map((row) => [row.path.toLowerCase(), row]),
);
const prepared = new Map(index.sources.map((row) => [row.hash, row.size]));
const validatedCache = new Map();
const byExtension = {};
const totals = {
  supportedSourceFiles: 0,
  supportedSourceBytes: 0,
  unsupportedBitmapFiles: 0,
  ignoredNonFontFiles: 0,
  missingRegisteredFiles: 0,
  oversizedOrEmptySources: 0,
  verifiedPreparedSources: 0,
  verifiedPreparedContentSources: 0,
  unindexedSources: 0,
  changedSources: 0,
  invalidOrMissingCachedFiles: 0,
};
const currentDigests = new Set();
for (const { path } of candidates.values()) {
  const extension = extname(path).toLowerCase();
  const bitmap = extension === ".fon" || extension === ".fnt";
  if (!supported.has(extension) && !bitmap) {
    totals.ignoredNonFontFiles++;
    continue;
  }
  let info;
  try {
    info = await stat(path);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    totals.missingRegisteredFiles++;
    continue;
  }
  if (!info.isFile()) continue;
  if (bitmap) {
    totals.unsupportedBitmapFiles++;
    byExtension[extension] = (byExtension[extension] ?? 0) + 1;
    continue;
  }
  totals.supportedSourceFiles++;
  totals.supportedSourceBytes += info.size;
  byExtension[extension] = (byExtension[extension] ?? 0) + 1;
  if (!info.size || info.size > contract.limits.maxSourceFileBytes) {
    totals.oversizedOrEmptySources++;
    continue;
  }
  const digest = sha(await readFile(path));
  currentDigests.add(digest);
  const row = indexed.get(path.toLowerCase());
  if (!row) {
    totals.unindexedSources++;
  } else if (row.hash !== digest || row.size !== info.size) {
    totals.changedSources++;
  }
  if (prepared.get(digest) !== info.size) continue;
  if (!validatedCache.has(digest)) {
    try {
      const bytes = await readFile(join(cache, digest));
      validatedCache.set(
        digest,
        bytes.length === info.size && sha(bytes) === digest,
      );
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      validatedCache.set(digest, false);
    }
  }
  if (validatedCache.get(digest)) {
    totals.verifiedPreparedContentSources++;
    if (row?.hash === digest && row.size === info.size)
      totals.verifiedPreparedSources++;
  } else totals.invalidOrMissingCachedFiles++;
}
const report = {
  capturedUtc: new Date().toISOString(),
  readOnly: true,
  sourceRoots: scans,
  sourceExtensions: byExtension,
  totals,
  currentDistinctSourceDigests: currentDigests.size,
  preparedIndex: {
    sources: index.sources.length,
    uniqueDigests: prepared.size,
    uniqueEncodedBytes: [...prepared.values()].reduce((a, b) => a + b, 0),
    sha256: sha(await readFile(indexPath)),
  },
  productContract: {
    supportedFormats: contract.supportedFormats,
    limits: contract.limits,
  },
  currentSupportedSourcePathsIndexed:
    totals.verifiedPreparedSources === totals.supportedSourceFiles,
  currentSupportedSourceContentVerifiedCached:
    totals.verifiedPreparedContentSources === totals.supportedSourceFiles,
  engineRegistration: {
    verified: false,
    files: null,
    faces: null,
    reason:
      "Read-only source/cache inspection does not observe the active Vision font registry.",
  },
  limits: [
    "No source path or catalogue credential is recorded.",
    "Index source-path coverage and verified indexed cache content are reported separately; moved packaged paths can retain the same cached digest.",
    "Cached content is not active catalogue admission, font parser compatibility, glyph coverage, browser registration or rendered typography proof.",
    "Missing and bitmap-only registered sources remain explicit exclusions; no font, cache, index or process is changed.",
  ],
};
await mkdir(dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify(report, null, 2) + "\n", {
  flag: "wx",
});
console.log(
  JSON.stringify({
    report: reportPath,
    totals,
    preparedIndex: report.preparedIndex,
    engineRegistrationVerified: false,
  }),
);
