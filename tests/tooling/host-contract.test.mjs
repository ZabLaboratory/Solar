import assert from "node:assert/strict";
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
