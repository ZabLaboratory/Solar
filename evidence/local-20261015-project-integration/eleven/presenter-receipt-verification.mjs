import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { createServer } from "vite";

const [input, output] = process.argv.slice(2);
assert(input && output, "Explicit immutable browser report and output paths required");
const bytes = await readFile(input);
const proof = JSON.parse(bytes);
const submitted = proof.presenterFrameSubmission;
assert.equal(submitted.schema, "vision.native-composition-frame/2");
assert.equal(proof.baselinePresenterNegative.emittedFrameSubmitted, false);
assert.equal(proof.baselinePresenterNegative.exactReceiptUnderTestReturnedToBaselinePresenter, true);
assert.equal(proof.baselinePresenterNegative.errorPhase, "render");
assert.match(proof.baselinePresenterNegative.errorMessage, /invalid native composition frame receipt/);
const frame = submitted.composition;
assert.equal(frame.sceneId, submitted.sceneId);
assert.equal(frame.sceneVersion, submitted.sceneVersion);
assert.equal(frame.coverageSurfaces.length, 1);

const server = await createServer({
  root: process.cwd(),
  cacheDir: ".cache/presenter-receipt-verification",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { projectNativeCompositionFrame } = await server.ssrLoadModule("/src/scenes/native-composition.ts");
  const context = {
    sceneId: frame.sceneId,
    sceneVersion: frame.sceneVersion,
    width: frame.sceneSize[0],
    height: frame.sceneSize[1],
    maxTextureSize: 16384,
  };
  const projection = projectNativeCompositionFrame(frame, context);
  assert(projection, "Actual presenter frame must be accepted by Solar");
  assert.equal(projection.coverageSurfaces.length, 1);
  const malformed = structuredClone(frame);
  malformed.coverageSurfaces[0].targetNodeId = 999999;
  let rejected = false;
  try { rejected = !projectNativeCompositionFrame(malformed, context); }
  catch { rejected = true; }
  assert(rejected, "A coverage target absent from the actual frame must be rejected");
  const report = {
    passed: true,
    capturedUtc: new Date().toISOString(),
    solarSource: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    input,
    inputSha256: createHash("sha256").update(bytes).digest("hex"),
    path: "Persisted actual createMainThreadPresenter WASM frame-submitted receipt through current Solar projector",
    projection,
    malformedCoverageTargetRejected: rejected,
    baselinePresenterNegative: proof.baselinePresenterNegative,
    limitations: "No new GPU host; persisted real presenter receipt. Does not qualify CEF, LSDP transport, physical captures or installed runtime.",
  };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ passed: true, coverage: projection.coverageSurfaces.length, malformedCoverageTargetRejected: rejected }));
} finally {
  await server.close();
}
