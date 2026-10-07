import assert from "node:assert/strict";
import { cp, mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { resolve, join, sep } from "node:path";
import { build } from "esbuild";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { unzipSync, strFromU8 } from "fflate";
const [scenePath, prismRoot, orionRoot] = process.argv.slice(2);
if (!scenePath || !prismRoot || !orionRoot)
  throw new Error(
    "Usage: test-reception-install <original.lsmlz> <Prism-worktree> <Orion-worktree>",
  );
const base = resolve("build");
await mkdir(base, { recursive: true });
const isolated = await mkdtemp(join(base, "native-installed-"));
if (!resolve(isolated).startsWith(base + sep))
  throw new Error("Invalid owned test path");
let adapter;
try {
  // Exactly the release directory layout Prism activates. No node_modules,
  // scripts, source tree, Cargo or esbuild is available in this runtime root.
  const releaseRoot = join(isolated, "solar");
  await cp(resolve("dist"), join(releaseRoot, "v3.0.0"), { recursive: true });
  const result = await build({
    entryPoints: [
      resolve(prismRoot, "src/main/runtime/solar/native-reception.ts"),
    ],
    bundle: true,
    platform: "node",
    format: "esm",
    write: false,
    plugins: [
      {
        name: "installed-package-root",
        setup(build) {
          build.onResolve({ filter: /solar-runtime-manager$/ }, () => ({
            path: "installed-package-root",
            namespace: "fixture",
          }));
          build.onLoad({ filter: /.*/, namespace: "fixture" }, () => ({
            contents: `export const getSolarRuntimeBundleDir=()=>${JSON.stringify(releaseRoot)};export const getActiveSolarReleaseTag=()=>"v3.0.0";`,
            loader: "js",
          }));
        },
      },
    ],
  });
  adapter = await import(
    `data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString("base64")}`
  );
  const native = await adapter.startNativeReception(
    "http://127.0.0.1:8099",
    (error) => {
      throw error;
    },
  );
  assert.equal((await adapter.readNativeScene("program")).state, null);
  const original = JSON.parse(
    strFromU8(unzipSync(await readFile(scenePath))["scene.lsml"]),
  );
  const received = await adapter.receiveNativeScene("program", original);
  assert.equal(received.status, "completed");
  assert.deepEqual((await adapter.readNativeScene("program")).state, original);
  const patched = await adapter.receiveNativeMutations("program", [
    {
      op: "replace",
      path: "/defaults/__lit.text.text_msxz43eh_1",
      value: "Installed reception",
    },
  ]);
  assert.equal(patched.level, "applied");
  assert.equal(
    (await adapter.readNativeScene("program")).state.defaults[
      "__lit.text.text_msxz43eh_1"
    ],
    "Installed reception",
  );
  assert.equal((await adapter.readNativeScene("preview")).state, null);
  const probe = await promisify(execFile)(
    "go",
    [
      "test",
      "-count=1",
      "-run",
      "TestRealSharedNative",
      "./internal/lsdpreception",
    ],
    {
      cwd: resolve(orionRoot),
      env: { ...process.env, ORION_TEST_LSDP_NATIVE_ADDRESS: native.address },
    },
  );
  assert.match(probe.stdout, /ok/);
  await adapter.stopNativeReception();
  assert.throws(() => process.kill(native.pid, 0));
  console.log(
    JSON.stringify({
      result: "PASS",
      nativePid: native.pid,
      sharedResources: native.resources,
      installedRuntime: "dist only; no source or node_modules",
      prismAdapter: "actual native-reception.ts with installed-root provider",
      orion: "actual Go TCP client/readiness/state route",
      fullLSMLReceived: true,
      explicitMutationApplied: true,
      previewIsolated: true,
      ownedProcessReaped: true,
    }),
  );
} finally {
  await adapter?.stopNativeReception();
  await rm(isolated, { recursive: true, force: true });
}
