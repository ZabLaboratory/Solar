import { applyEditableFastPatch } from "./dom";
import { parseEditableFastPatch, type EditableFastPatch } from "./patch";

export function editablePreviewFastPathEnabled(
  search = globalThis.location?.search ?? "",
): boolean {
  return new URLSearchParams(search).get("editable_fast") === "1";
}

export function readEditablePreviewSidebandUrl(
  search = globalThis.location?.search ?? "",
): string | null {
  const params = new URLSearchParams(search);
  if (params.get("editable_fast") !== "1") return null;
  const raw = params.get("editable_fast_url");
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== "ws:" ||
      !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname)
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

export function parseAcceptedEditablePatches(
  data: unknown,
): EditableFastPatch[] {
  if (typeof data !== "string") return [];
  let frame: unknown;
  try {
    frame = JSON.parse(data) as unknown;
  } catch {
    return [];
  }
  if (!frame || typeof frame !== "object") return [];
  const candidate = frame as { type?: unknown; patches?: unknown };
  if (
    candidate.type !== "accepted_patch" ||
    !Array.isArray(candidate.patches)
  ) {
    return [];
  }
  return candidate.patches
    .map(parseEditableFastPatch)
    .filter((patch): patch is EditableFastPatch => patch !== null);
}

export function installEditablePreviewSideband(
  url: string,
  root: ParentNode = document,
  NativeWebSocket: typeof WebSocket = globalThis.WebSocket,
): () => void {
  const convergenceLeaseMs = 1_250;
  let stopped = false;
  let socket: WebSocket | null = null;
  let retryTimer: ReturnType<typeof setTimeout> | null = null;
  let convergenceFrame: number | null = null;
  let retryMs = 100;
  const convergence = new Map<
    string,
    { patch: EditableFastPatch; expiresAt: number }
  >();

  // Framer Motion owns the same inline styles as the regular LSDP consumer.
  // A Solar sideband write can therefore be overwritten on the following
  // animation frame by the still-old MotionValue, long before OBS captures it.
  // Keep the Orion-accepted value pinned only for the bounded interval in
  // which the ordinary LSDP delta converges. This does not invent state: both
  // paths carry the exact same accepted patch, and the lease expires even if
  // the regular consumer disconnects.
  const flushConvergence = (): void => {
    convergenceFrame = null;
    if (stopped) return;
    const now = performance.now();
    for (const [key, lease] of convergence) {
      if (lease.expiresAt <= now) {
        convergence.delete(key);
        continue;
      }
      applyEditableFastPatch(lease.patch, root, "important");
    }
    if (convergence.size > 0) {
      convergenceFrame = requestAnimationFrame(flushConvergence);
    }
  };

  const pinAcceptedPatch = (patch: EditableFastPatch): void => {
    const key = `${patch.componentId}:${patch.property}`;
    convergence.set(key, {
      patch,
      expiresAt: performance.now() + convergenceLeaseMs,
    });
    applyEditableFastPatch(patch, root, "important");
    if (convergenceFrame === null) {
      convergenceFrame = requestAnimationFrame(flushConvergence);
    }
  };

  const connect = (): void => {
    if (stopped) return;
    const next = new NativeWebSocket(url);
    socket = next;
    next.addEventListener("open", () => {
      retryMs = 100;
    });
    next.addEventListener("message", (event) => {
      for (const patch of parseAcceptedEditablePatches(event.data)) {
        pinAcceptedPatch(patch);
      }
    });
    next.addEventListener("close", () => {
      if (socket === next) socket = null;
      if (stopped) return;
      retryTimer = setTimeout(connect, retryMs);
      retryMs = Math.min(retryMs * 2, 1_000);
    });
  };

  connect();
  return () => {
    stopped = true;
    if (retryTimer !== null) clearTimeout(retryTimer);
    if (convergenceFrame !== null) cancelAnimationFrame(convergenceFrame);
    convergence.clear();
    socket?.close(1000, "solar teardown");
    socket = null;
  };
}
