const EDITABLE_PATCH_PATH =
  /^__editable\.([0-9a-f]+)\.(translate|width|height|visible|opacity|rotation|zIndex|value|fontSize|fontWeight|colour|lineHeight|src|fill|radius|background)$/i;

export interface EditableTranslatePatch {
  componentId: string;
  property: "translate";
  x: number;
  y: number;
}

export interface EditableScalarPatch {
  componentId: string;
  property:
    | "width"
    | "height"
    | "visible"
    | "opacity"
    | "rotation"
    | "zIndex"
    | "value"
    | "fontSize"
    | "fontWeight"
    | "colour"
    | "lineHeight"
    | "src"
    | "fill"
    | "radius"
    | "background";
  value: string | number | boolean;
}

export type EditableFastPatch = EditableTranslatePatch | EditableScalarPatch;

function decodeComponentToken(token: string): string | null {
  if (token.length === 0 || token.length % 2 !== 0 || token.length > 2048) {
    return null;
  }
  const bytes = new Uint8Array(token.length / 2);
  for (let index = 0; index < bytes.length; index += 1) {
    const value = Number.parseInt(token.slice(index * 2, index * 2 + 2), 16);
    if (!Number.isInteger(value)) return null;
    bytes[index] = value;
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function finiteCoordinate(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Math.abs(value) <= 1_000_000
  );
}

export function parseEditableTranslatePatch(
  value: unknown,
): EditableTranslatePatch | null {
  const parsed = parseEditableFastPatch(value);
  return parsed?.property === "translate" ? parsed : null;
}

function boundedNumber(
  value: unknown,
  minimum: number,
  maximum: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= minimum &&
    value <= maximum
  );
}

function safeString(value: unknown, maximum = 16_384): value is string {
  return typeof value === "string" && value.length <= maximum;
}

function safeColour(value: unknown): value is string {
  return (
    safeString(value, 256) &&
    !/[;{}<>\\]/.test(value) &&
    !/^\s*(?:url|var)\s*\(/i.test(value)
  );
}

function safeMediaSource(value: unknown): value is string {
  if (!safeString(value, 16_384)) return false;
  try {
    const url = new URL(
      value,
      globalThis.location?.href ?? "http://localhost/",
    );
    if (["http:", "https:", "blob:"].includes(url.protocol)) return true;
    return (
      url.protocol === "data:" && /^data:(?:image|audio|video)\//i.test(value)
    );
  } catch {
    return false;
  }
}

export function parseEditableFastPatch(
  value: unknown,
): EditableFastPatch | null {
  if (!value || typeof value !== "object") return null;
  const patch = value as { path?: unknown; value?: unknown };
  if (typeof patch.path !== "string") return null;
  const match = EDITABLE_PATCH_PATH.exec(patch.path);
  if (!match) return null;
  const componentId = decodeComponentToken(match[1] ?? "");
  if (componentId === null) return null;
  const property = match[2] as EditableFastPatch["property"];
  if (property === "translate") {
    if (!Array.isArray(patch.value) || patch.value.length !== 2) return null;
    const [x, y] = patch.value;
    return finiteCoordinate(x) && finiteCoordinate(y)
      ? { componentId, property, x, y }
      : null;
  }
  const candidate = patch.value;
  switch (property) {
    case "width":
    case "height":
      return boundedNumber(candidate, 0, 100_000)
        ? { componentId, property, value: candidate }
        : null;
    case "visible":
      return typeof candidate === "boolean"
        ? { componentId, property, value: candidate }
        : null;
    case "opacity":
      return boundedNumber(candidate, 0, 1)
        ? { componentId, property, value: candidate }
        : null;
    case "rotation":
      return boundedNumber(candidate, -100_000, 100_000)
        ? { componentId, property, value: candidate }
        : null;
    case "zIndex":
      return Number.isInteger(candidate) &&
        boundedNumber(candidate, -1_000_000, 1_000_000)
        ? { componentId, property, value: candidate }
        : null;
    case "fontSize":
      return boundedNumber(candidate, 0, 10_000)
        ? { componentId, property, value: candidate }
        : null;
    case "fontWeight":
      return boundedNumber(candidate, 1, 1_000)
        ? { componentId, property, value: candidate }
        : null;
    case "radius":
      return boundedNumber(candidate, 0, 100_000)
        ? { componentId, property, value: candidate }
        : null;
    case "lineHeight":
      return candidate === "normal" || boundedNumber(candidate, 0, 100)
        ? { componentId, property, value: candidate }
        : null;
    case "colour":
    case "fill":
    case "background":
      return safeColour(candidate)
        ? { componentId, property, value: candidate }
        : null;
    case "src":
      return safeMediaSource(candidate)
        ? { componentId, property, value: candidate }
        : null;
    case "value":
      return safeString(candidate)
        ? { componentId, property, value: candidate }
        : null;
  }
}

/**
 * Mirror the LSDP sequence gate before touching pixels. The regular Lumencast
 * client remains authoritative and consumes the same frame immediately after
 * this hook; duplicates, gaps, pre-snapshot deltas and scene transitions are
 * deliberately inert here as well.
 */
export class EditablePreviewDeltaGate {
  private sequence: number | null = null;

  accept(data: unknown): EditableFastPatch[] {
    if (typeof data !== "string") return [];
    let frame: unknown;
    try {
      frame = JSON.parse(data) as unknown;
    } catch {
      return [];
    }
    if (!frame || typeof frame !== "object") return [];
    const candidate = frame as {
      type?: unknown;
      seq?: unknown;
      patches?: unknown;
    };
    if (candidate.type === "snapshot") {
      this.sequence =
        Number.isInteger(candidate.seq) && (candidate.seq as number) >= 1
          ? (candidate.seq as number)
          : null;
      return [];
    }
    if (candidate.type === "scene_changed") {
      this.sequence = null;
      return [];
    }
    if (candidate.type !== "delta" || !Number.isInteger(candidate.seq)) {
      return [];
    }
    const sequence = candidate.seq as number;
    if (this.sequence === null || sequence <= this.sequence) return [];
    if (sequence !== this.sequence + 1) {
      this.sequence = null;
      return [];
    }
    this.sequence = sequence;
    if (!Array.isArray(candidate.patches)) return [];
    return candidate.patches
      .map(parseEditableFastPatch)
      .filter((patch): patch is EditableFastPatch => patch !== null);
  }
}

export function applyEditableTranslatePatch(
  patch: EditableTranslatePatch,
  root: ParentNode = document,
  priority: "" | "important" = "",
): boolean {
  let applied = false;
  for (const node of root.querySelectorAll<HTMLElement>(
    "[data-lumencast-bind-animate]",
  )) {
    if (
      node.getAttribute("data-lumencast-bind-animate") !== patch.componentId
    ) {
      continue;
    }
    const transform = `translate3d(${patch.x}px, ${patch.y}px, 0px)`;
    if (
      node.style.getPropertyValue("transform") !== transform ||
      node.style.getPropertyPriority("transform") !== priority
    ) {
      node.style.willChange = "transform";
      node.style.setProperty("transform", transform, priority);
    }
    applied = true;
  }
  return applied;
}

function editableNode(
  componentId: string,
  root: ParentNode,
): HTMLElement | null {
  for (const node of root.querySelectorAll<HTMLElement>(
    "[data-lumencast-bind-animate]",
  )) {
    if (node.getAttribute("data-lumencast-bind-animate") === componentId) {
      return node;
    }
  }
  return null;
}

function sizedElements(node: HTMLElement): HTMLElement[] {
  return [
    node,
    ...node.querySelectorAll<HTMLElement>("div,svg,img,video,canvas"),
  ];
}

export function applyEditableFastPatch(
  patch: EditableFastPatch,
  root: ParentNode = document,
  priority: "" | "important" = "",
): boolean {
  if (patch.property === "translate") {
    return applyEditableTranslatePatch(patch, root, priority);
  }
  const node = editableNode(patch.componentId, root);
  if (!node) return false;
  const value = patch.value;
  switch (patch.property) {
    case "width":
    case "height": {
      const cssValue = `${value}px`;
      for (const element of sizedElements(node)) {
        if (priority)
          element.style.setProperty(patch.property, cssValue, priority);
        else element.style[patch.property] = cssValue;
        if (element instanceof SVGElement) {
          element.setAttribute(patch.property, String(value));
          if (patch.property === "width") {
            const height = Number.parseFloat(
              element.getAttribute("height") ?? "0",
            );
            if (height > 0)
              element.setAttribute("viewBox", `0 0 ${value} ${height}`);
          } else {
            const width = Number.parseFloat(
              element.getAttribute("width") ?? "0",
            );
            if (width > 0)
              element.setAttribute("viewBox", `0 0 ${width} ${value}`);
          }
        }
      }
      return true;
    }
    case "visible":
      if (priority) {
        node.style.setProperty(
          "visibility",
          value ? "visible" : "hidden",
          priority,
        );
      } else {
        node.style.visibility = value ? "visible" : "hidden";
      }
      return true;
    case "opacity":
      if (priority) node.style.setProperty("opacity", String(value), priority);
      else node.style.opacity = String(value);
      return true;
    case "rotation":
      if (priority) node.style.setProperty("rotate", `${value}deg`, priority);
      else node.style.rotate = `${value}deg`;
      return true;
    case "zIndex":
      if (priority) node.style.setProperty("z-index", String(value), priority);
      else node.style.zIndex = String(value);
      return true;
    case "value": {
      const text = node.querySelector<HTMLElement>("span");
      if (!text) return false;
      text.textContent = String(value);
      return true;
    }
    case "fontSize":
    case "fontWeight":
    case "colour":
    case "lineHeight": {
      const text = node.querySelector<HTMLElement>("span");
      if (!text) return false;
      if (patch.property === "fontSize") {
        if (priority)
          text.style.setProperty("font-size", `${value}px`, priority);
        else text.style.fontSize = `${value}px`;
      } else if (patch.property === "fontWeight") {
        if (priority)
          text.style.setProperty("font-weight", String(value), priority);
        else text.style.fontWeight = String(value);
      } else if (patch.property === "colour") {
        if (priority) text.style.setProperty("color", String(value), priority);
        else text.style.color = String(value);
      } else if (priority) {
        text.style.setProperty("line-height", String(value), priority);
      } else {
        text.style.lineHeight = String(value);
      }
      return true;
    }
    case "src": {
      const media = node.querySelector<HTMLImageElement | HTMLMediaElement>(
        "img,video,audio",
      );
      if (!media) return false;
      media.src = String(value);
      if (media instanceof HTMLMediaElement)
        void media.play().catch(() => undefined);
      return true;
    }
    case "fill": {
      const paints = node.querySelectorAll<SVGElement>(
        "svg path,svg rect,svg circle,svg ellipse,svg polygon,svg line",
      );
      for (const paint of paints) {
        if (paint.getAttribute("fill") !== "none")
          paint.setAttribute("fill", String(value));
      }
      return paints.length > 0;
    }
    case "radius":
      for (const element of sizedElements(node))
        if (priority)
          element.style.setProperty("border-radius", `${value}px`, priority);
        else element.style.borderRadius = `${value}px`;
      return true;
    case "background":
      for (const element of sizedElements(node))
        if (priority)
          element.style.setProperty("background", String(value), priority);
        else element.style.background = String(value);
      return true;
  }
}

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

/**
 * Preview-only WebSocket adapter. It does not invent state: it applies only a
 * sequence-valid `__editable.*.translate` patch received on the real LSDP
 * Preview wire, directly to the matching Solar compositor wrapper. Program
 * never opts into this adapter.
 */
export function createEditablePreviewWebSocket(
  NativeWebSocket: typeof WebSocket = globalThis.WebSocket,
  root: ParentNode = document,
): typeof WebSocket {
  class EditablePreviewWebSocket extends NativeWebSocket {
    private readonly editableGate = new EditablePreviewDeltaGate();

    constructor(url: string | URL, protocols?: string | string[]) {
      super(url, protocols);
      super.addEventListener("message", (event) => {
        for (const patch of this.editableGate.accept(event.data)) {
          applyEditableFastPatch(patch, root);
        }
      });
    }
  }
  return EditablePreviewWebSocket as unknown as typeof WebSocket;
}
