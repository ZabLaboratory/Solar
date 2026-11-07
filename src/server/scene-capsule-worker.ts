import { parentPort } from "node:worker_threads";
import { decodeSceneSource, encodeSceneSource } from "../scenes/cache";
import type { SceneSourceDelivery } from "../scenes/types";

type Request =
  | { id: number; operation: "encode"; value: SceneSourceDelivery }
  | { id: number; operation: "decode"; value: Uint8Array };

const port = parentPort;
if (!port) throw new Error("SOURCE_CACHE_WORKER_PORT_REQUIRED");
port.on("message", (request: Request) => {
  try {
    const value =
      request.operation === "encode"
        ? encodeSceneSource(request.value)
        : decodeSceneSource(request.value);
    const arrays =
      value instanceof Uint8Array
        ? [value]
        : [value.data, ...value.assets.values()];
    const transfers = [
      ...new Set(
        arrays
          .map((bytes) => bytes.buffer)
          .filter(
            (buffer): buffer is ArrayBuffer => buffer instanceof ArrayBuffer,
          ),
      ),
    ];
    port.postMessage({ id: request.id, value }, transfers);
  } catch (cause) {
    port.postMessage({
      id: request.id,
      error:
        cause instanceof Error ? cause.message : "SOURCE_CACHE_CODEC_FAILED",
    });
  }
});
