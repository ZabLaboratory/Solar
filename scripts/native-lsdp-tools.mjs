import { SolarReceptionServer } from "../dist/server/index.mjs";
import { build } from "esbuild";
import { resolve } from "node:path";
import { BrowserLSDP } from "../vendor/lsdp-native-browser/src/browser.js";

// Bundle the exact browser hash implementation in memory for Node >=20 tools.
const built = await build({
  stdin: {
    contents:
      'export { nativeTreeHash } from "./src/internal/native-tree.ts"; export { NativeState } from "./src/internal/native-state.ts";',
    resolveDir: resolve(import.meta.dirname, ".."),
  },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
export const { nativeTreeHash, NativeState } = await import(
  `data:text/javascript;base64,${Buffer.from(built.outputFiles[0].text).toString("base64")}`
);

export async function startNative(binary, document, origin, onFailure) {
  const reception = new SolarReceptionServer({
    binaryPath: binary,
    origins: [origin],
    resources: {
      scene: { type: "solar.lsml/1", initial: document },
      "orion/state": { type: "orion.state/1", initial: {} },
      "solar/program": { type: "solar.lsml/1", initial: null },
      "solar/preview": { type: "solar.lsml/1", initial: null },
      "solar/generations": { type: "orion.state/1", initial: {} },
      "solar/sessions": { type: "orion.state/1", initial: {} },
    },
    onFailure,
  });
  const connection = await reception.start();
  return {
    reception,
    url: connection.websocketUrl,
    get pid() {
      return reception.status().pid;
    },
    address: connection.address,
    stop: () => reception.stop(),
  };
}

export async function readNative(peer, target = "scene") {
  const previous = peer.options.onTransaction;
  let resolve, reject;
  const result = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  const timer = setTimeout(
    () => reject(new Error("Native snapshot timed out.")),
    30_000,
  );
  void result.catch(() => {});
  peer.options.onTransaction = async (value, context) => {
    if (
      context.metadata.profile !== "lsdp.state.read/1" ||
      context.metadata.target !== target
    ) {
      if (previous) return previous(value, context);
      throw new Error("Unexpected native download.");
    }
    const stateHash = nativeTreeHash(value);
    resolve({ state: value, stateHash });
    return { level: "applied", stateHash };
  };
  try {
    await peer.transaction({ kind: "state.read", target });
    return await result;
  } finally {
    clearTimeout(timer);
    peer.options.onTransaction = previous;
  }
}

export async function withNative(url, callback) {
  const peer = new BrowserLSDP(url);
  try {
    await peer.ready;
    return await callback(peer);
  } finally {
    peer.close();
  }
}
