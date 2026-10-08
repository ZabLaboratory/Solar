import type { MountOptions, ResolveCaptureDevice } from "../types";

// The embedding host pins a `deviceRef → deviceId` map before Solar mounts.
// Keep the global name aligned with Prism's injectBootstrap contract.
const ZAB_CAPTURE_DEVICES_GLOBAL = "__ZAB_CAPTURE_DEVICES__";
const ZAB_CAPTURE_DEFAULT_SCREEN_GLOBAL = "__ZAB_CAPTURE_DEFAULT_SCREEN__";

// One host-injected entry: a portable label plus the picker-origin deviceId (not
// reusable here) for cams, or an origin-independent captureSourceId for screens.
interface ZabCaptureEntry {
  label?: string;
  deviceId?: string;
  captureSourceId?: string;
  kind?: string;
}

// Per-origin label → deviceId, resolved once and shared across capture nodes.
// getUserMedia deviceIds are salted per origin/partition, so the picker-origin
// id is useless in this webview; the LABEL is the portable key. enumerateDevices
// only exposes labels after a getUserMedia grant in THIS origin, so we warm one
// up first (auto-granted in the preview webview), best-effort.
let originLabelMapPromise: Promise<Record<string, string>> | null = null;

function originLabelMap(): Promise<Record<string, string>> {
  if (originLabelMapPromise !== null) return originLabelMapPromise;
  originLabelMapPromise = (async () => {
    const md =
      typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
    if (md?.enumerateDevices === undefined) return {};
    try {
      if (md.getUserMedia !== undefined) {
        const warm = await md.getUserMedia({ video: true });
        for (const t of warm.getTracks()) t.stop();
      }
    } catch {
      /* permission denied → labels stay blank, resolve to {} (PLACEHOLDER) */
    }
    const out: Record<string, string> = {};
    try {
      for (const d of await md.enumerateDevices()) {
        if (d.label.length > 0) out[d.label] = d.deviceId;
      }
    } catch {
      /* best-effort */
    }
    return out;
  })();
  return originLabelMapPromise;
}

// Default resolver. A declared
// deviceRef with no resolvable device → `null`. The runtime remains fail-closed
// for cameras, apps, and windows; media.screen alone may use the host's explicit
// machine-local display mapping, which Prism resolves before serving the page.
// If that mapping is unavailable, return null and keep the declared screen
// fail-closed: a cold scene must never open a native display picker or bind an
// arbitrary surface. The runtime AWAITS this, so there is no race against a
// late global mutation.
const captureDeviceResolver: ResolveCaptureDevice = async (
  deviceRef,
  sourceKind,
) => {
  const map = (
    globalThis as {
      [ZAB_CAPTURE_DEVICES_GLOBAL]?: Record<string, ZabCaptureEntry>;
    }
  )[ZAB_CAPTURE_DEVICES_GLOBAL];
  const entry = map?.[deviceRef];
  let defaultScreen = (
    globalThis as {
      [ZAB_CAPTURE_DEFAULT_SCREEN_GLOBAL]?: ZabCaptureEntry | null;
    }
  )[ZAB_CAPTURE_DEFAULT_SCREEN_GLOBAL];
  // Screen/window/app: a desktopCapturer source id is origin-independent →
  // verbatim. `media.app` (RFC-0001 Amendment 3) resolves the SAME shape —
  // Prism's page-global injection re-resolves it fresh (against the
  // currently open windows, by app name) on every serve, so by the time it
  // reaches here it is just another desktopCapturer id, exactly like a
  // picked window.
  if (
    sourceKind === "media.screen" ||
    sourceKind === "media.window" ||
    sourceKind === "media.app"
  ) {
    if (
      sourceKind === "media.screen" &&
      !entry?.captureSourceId &&
      !defaultScreen?.captureSourceId
    ) {
      const resolveDefault = (
        globalThis as {
          __ZAB_CAPTURE_RESOLVE_DEFAULT_SCREEN__?: () => Promise<ZabCaptureEntry | null>;
        }
      ).__ZAB_CAPTURE_RESOLVE_DEFAULT_SCREEN__;
      if (typeof resolveDefault === "function")
        defaultScreen = await resolveDefault();
    }
    const captureSourceId =
      entry?.captureSourceId ??
      (sourceKind === "media.screen"
        ? defaultScreen?.captureSourceId
        : undefined);
    return captureSourceId !== undefined && captureSourceId !== ""
      ? { captureSourceId }
      : null;
  }
  if (entry === undefined) {
    return null;
  }
  // Cam/mic: re-resolve the PORTABLE label against this origin's devices. No
  // label / no match → null → PLACEHOLDER, never the wrong default cam.
  if (entry.label === undefined || entry.label === "") {
    return null;
  }
  const byLabel = await originLabelMap();
  const local = byLabel[entry.label];
  return local !== undefined ? { deviceId: local } : null;
};

export function createCaptureResolver(
  options: Pick<MountOptions, "resolveCaptureDevice">,
): ResolveCaptureDevice {
  // Camera sources are part of the scene and are uploaded to Vision like the
  // other live textures. There is no broadcast-only placeholder branch.
  return options.resolveCaptureDevice ?? captureDeviceResolver;
}
