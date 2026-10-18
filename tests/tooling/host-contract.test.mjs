import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { test } from "node:test";
import {
  hostContract,
  requireHostContract,
} from "../../scripts/host-contract.mjs";

test("emitted Solar host contract advertises native composition without changing v2", () => {
  assert.equal(hostContract.schema_version, "solar.host.contract.v1");
  assert.equal(hostContract.protocol_version, "solar.host.v2");
  assert.deepEqual(hostContract.capabilities, [
    "solar.vision.lsml.v1",
    "solar.native-lsdp.v1",
    "solar.source-provider.v1",
    "prism.camera.routing-readback.v1",
    "solar.native-composition.resource.v1",
  ]);
  assert.equal(requireHostContract(hostContract), hostContract);
});

test("a complete old v2 host without only native composition is rejected", () => {
  const oldHostContract = {
    ...hostContract,
    capabilities: hostContract.capabilities.filter(
      (capability) => capability !== "solar.native-composition.resource.v1",
    ),
  };
  assert.throws(
    () => requireHostContract(oldHostContract),
    /does not advertise the native composition resource/,
  );
});

test("release manifest declares the protocol actually packaged with Solar", () => {
  const workspace = mkdtempSync(join(tmpdir(), "solar-release-protocol-"));
  try {
    mkdirSync(join(workspace, "dist", "native"), { recursive: true });
    mkdirSync(join(workspace, "dist", "host"), { recursive: true });
    writeFileSync(join(workspace, "runtime.tgz"), "fixture");
    writeFileSync(
      join(workspace, "dist", "native", "manifest.json"),
      JSON.stringify({
        schema: "solar.native-server.v1",
        wire: "LSDP-TCP/2.0-draft2",
        source_revision: "fixture",
        binaries: { "win32-x64": {}, "linux-x64": {} },
      }),
    );
    const hostPath = join(
      workspace,
      "dist",
      "host",
      "solar-host-contract.json",
    );
    const manifestPath = join(workspace, "runtime-manifest.json");
    const command = resolve("scripts/create-runtime-manifest.mjs");
    const run = () =>
      spawnSync(
        process.execPath,
        [
          command,
          "runtime.tgz",
          "3.0.0",
          "ZabLaboratory/Solar",
          "v3.0.0",
          manifestPath,
        ],
        { cwd: workspace, encoding: "utf8" },
      );
    writeFileSync(hostPath, JSON.stringify(hostContract));
    assert.equal(run().status, 0);
    assert.equal(
      JSON.parse(readFileSync(manifestPath, "utf8")).protocol_version,
      "solar.host.v2",
    );
    writeFileSync(
      hostPath,
      JSON.stringify({ ...hostContract, protocol_version: "solar.host.v1" }),
    );
    assert.notEqual(run().status, 0);
  } finally {
    rmSync(workspace, { recursive: true, force: true });
  }
});
