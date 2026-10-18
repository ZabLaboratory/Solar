export const hostContract = {
  schema_version: "solar.host.contract.v1",
  protocol_version: "solar.host.v2",
  capabilities: [
    "solar.vision.lsml.v1",
    "solar.native-lsdp.v1",
    "solar.source-provider.v1",
    "prism.camera.routing-readback.v1",
    "solar.native-composition.resource.v1",
  ],
};

/** Require the installed host to advertise both native receiver contracts. */
export function requireHostContract(contract) {
  if (
    contract?.protocol_version !== "solar.host.v2" ||
    !Array.isArray(contract.capabilities) ||
    !contract.capabilities.includes("prism.camera.routing-readback.v1")
  ) {
    throw new Error(
      "Solar host contract does not advertise Prism camera routing readback.",
    );
  }
  if (!contract.capabilities.includes("solar.native-composition.resource.v1")) {
    throw new Error(
      "Solar host contract does not advertise the native composition resource.",
    );
  }
  return contract;
}
