import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { createServer } from "vite";

const input = process.argv[2];
const output = process.argv[3];
assert(input && output, "Explicit browser report and output paths required");
const bytes = await readFile(input);
const proof = JSON.parse(bytes);
const server = await createServer({
  root: process.cwd(),
  cacheDir: ".cache/coverage-receipt-verification",
  optimizeDeps: { noDiscovery: true, include: [] },
  server: { middlewareMode: true },
  appType: "custom",
});
try {
  const { projectNativeCompositionFrame } = await server.ssrLoadModule("/src/scenes/native-composition.ts");
  const frames = [proof.initial.first, proof.masked.frame, proof.frameMask];
  const admitted = frames.map(frame => {
    const projection = projectNativeCompositionFrame(frame, {
      sceneId: frame.sceneId,
      sceneVersion: frame.sceneVersion,
      width: frame.sceneSize[0],
      height: frame.sceneSize[1],
      maxTextureSize: 16384,
    });
    assert(projection, "Actual Vision frame must be admitted");
    return { frame, projection };
  });
  assert.equal(admitted[0].frame.schema, "vision.native-composition-frame/1");
  assert.equal(admitted[1].frame.schema, "vision.native-composition-frame/2");
  assert.equal(admitted[2].frame.schema, "vision.native-composition-frame/2");
  assert.equal(admitted[1].projection.coverageSurfaces.length, 2);
  assert.equal(admitted[2].projection.coverageSurfaces.length, 1);
  const report = {
    passed: true,
    capturedUtc: new Date().toISOString(),
    input,
    inputSha256: createHash("sha256").update(bytes).digest("hex"),
    visionSource: "4dbc6cdf38a33ae944fddd8d70853093b1593f5c",
    visionQualification: "85c49664a029744369b063ddffaa92415a59c8a8",
    solarSource: "ebda7b1d3827d36d47193757377050ec19ed1d62",
    limits: "Actual persisted browser receipts through unchanged Solar projector; not a running CEF/LSDP/native presentation chain.",
    admitted,
  };
  await writeFile(output, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(admitted.map(({ frame, projection }) => ({ schema: frame.schema, coverage: projection.coverageSurfaces?.length ?? 0 }))));
} finally {
  await server.close();
}
