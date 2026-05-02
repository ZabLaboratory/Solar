// Encode / decode + validation of the WS envelope (ADR 002).
//
// Validation is fail-loud : a malformed message becomes a `CodecError`
// and the WS layer turns it into a `SolarError` with code "INTERNAL".
// The runtime never tries to coerce a bad payload — silent recovery is
// how scene state diverges between Orion and Solar.

import type {
  ClientMessage,
  ServerMessage,
  ServerErrorCode,
  Patch,
  Transition,
} from "./protocol";
import { PROTOCOL_VERSION } from "./protocol";

const SERVER_TYPES = [
  "snapshot",
  "delta",
  "scene_changed",
  "error",
  "pong",
] as const;
type ServerType = (typeof SERVER_TYPES)[number];

export class CodecError extends Error {
  constructor(
    public readonly reason: string,
    public readonly raw?: unknown,
  ) {
    super(`Solar codec : ${reason}`);
    this.name = "CodecError";
  }
}

// --- encode ---------------------------------------------------------

export function encode(message: ClientMessage): string {
  return JSON.stringify(message);
}

// --- decode + validate ---------------------------------------------

export function decode(raw: string): ServerMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CodecError(`invalid JSON : ${(err as Error).message}`, raw);
  }
  return validateServerMessage(parsed);
}

function validateServerMessage(value: unknown): ServerMessage {
  if (!isObject(value)) {
    throw new CodecError("server message must be an object", value);
  }
  const type = value.type;
  if (typeof type !== "string" || !SERVER_TYPES.includes(type as ServerType)) {
    throw new CodecError(`unknown server message type : ${String(type)}`, value);
  }
  if (value.v !== PROTOCOL_VERSION) {
    throw new CodecError(
      `protocol version mismatch : expected ${PROTOCOL_VERSION}, got ${String(value.v)}`,
      value,
    );
  }

  switch (type as ServerType) {
    case "snapshot":
      return validateSnapshot(value);
    case "delta":
      return validateDelta(value);
    case "scene_changed":
      return validateSceneChanged(value);
    case "error":
      return validateError(value);
    case "pong":
      return validatePong(value);
  }
}

function validateSnapshot(v: Record<string, unknown>): ServerMessage {
  const sceneId = expectString(v, "scene_id");
  const sceneVersion = expectString(v, "scene_version");
  const sequence = expectNumber(v, "sequence");
  const state = v.state;
  if (!isObject(state)) {
    throw new CodecError("snapshot.state must be an object", v);
  }
  return {
    type: "snapshot",
    v: PROTOCOL_VERSION,
    scene_id: sceneId,
    scene_version: sceneVersion,
    sequence,
    state: state as Record<string, unknown>,
  };
}

function validateDelta(v: Record<string, unknown>): ServerMessage {
  const sceneId = expectString(v, "scene_id");
  const sequence = expectNumber(v, "sequence");
  const patches = v.patches;
  if (!Array.isArray(patches)) {
    throw new CodecError("delta.patches must be an array", v);
  }
  const validatedPatches: Patch[] = patches.map((p, idx) =>
    validatePatch(p, idx),
  );
  const cause = v.cause;
  let validatedCause: { source: string; input_id?: string } | undefined;
  if (cause !== undefined) {
    if (!isObject(cause)) {
      throw new CodecError("delta.cause must be an object", v);
    }
    const source = expectString(cause, "source");
    const inputId = cause.input_id;
    if (inputId !== undefined && typeof inputId !== "string") {
      throw new CodecError("delta.cause.input_id must be a string", v);
    }
    validatedCause = inputId !== undefined ? { source, input_id: inputId } : { source };
  }
  return {
    type: "delta",
    v: PROTOCOL_VERSION,
    scene_id: sceneId,
    sequence,
    patches: validatedPatches,
    ...(validatedCause ? { cause: validatedCause } : {}),
  };
}

function validatePatch(value: unknown, idx: number): Patch {
  if (!isObject(value)) {
    throw new CodecError(`delta.patches[${idx}] must be an object`, value);
  }
  if (typeof value.path !== "string") {
    throw new CodecError(`delta.patches[${idx}].path must be a string`, value);
  }
  if (!("value" in value)) {
    throw new CodecError(`delta.patches[${idx}].value missing`, value);
  }
  const patch: Patch = { path: value.path, value: value.value };
  if (value.transition !== undefined) {
    patch.transition = validateTransition(value.transition);
  }
  return patch;
}

function validateTransition(value: unknown): Transition {
  if (!isObject(value)) {
    throw new CodecError("transition must be an object", value);
  }
  switch (value.kind) {
    case "none":
      return { kind: "none" };
    case "tween": {
      const duration_ms = expectNumber(value, "duration_ms");
      const ease = value.ease;
      if (
        ease !== undefined &&
        ease !== "linear" &&
        ease !== "cubic-in" &&
        ease !== "cubic-out" &&
        ease !== "cubic-in-out"
      ) {
        throw new CodecError(`unsupported tween ease : ${String(ease)}`, value);
      }
      return { kind: "tween", duration_ms, ...(ease ? { ease } : {}) };
    }
    case "spring": {
      const stiffness =
        value.stiffness === undefined ? undefined : expectNumber(value, "stiffness");
      const damping =
        value.damping === undefined ? undefined : expectNumber(value, "damping");
      return {
        kind: "spring",
        ...(stiffness !== undefined ? { stiffness } : {}),
        ...(damping !== undefined ? { damping } : {}),
      };
    }
    case "crossfade": {
      const duration_ms =
        value.duration_ms === undefined
          ? undefined
          : expectNumber(value, "duration_ms");
      return {
        kind: "crossfade",
        ...(duration_ms !== undefined ? { duration_ms } : {}),
      };
    }
    default:
      throw new CodecError(`unknown transition kind : ${String(value.kind)}`, value);
  }
}

function validateSceneChanged(v: Record<string, unknown>): ServerMessage {
  const fromSceneId = expectString(v, "from_scene_id");
  const toSceneId = expectString(v, "to_scene_id");
  let transition: Transition | undefined;
  if (v.transition !== undefined) {
    const t = validateTransition(v.transition);
    if (t.kind !== "crossfade" && t.kind !== "tween") {
      throw new CodecError(
        `scene_changed.transition must be crossfade or tween, got ${t.kind}`,
        v,
      );
    }
    transition = t;
  }
  return {
    type: "scene_changed",
    v: PROTOCOL_VERSION,
    from_scene_id: fromSceneId,
    to_scene_id: toSceneId,
    ...(transition ? { transition: transition as never } : {}),
  };
}

function validateError(v: Record<string, unknown>): ServerMessage {
  const code = v.code;
  const VALID_CODES: ReadonlyArray<ServerErrorCode> = [
    "AUTH_DENIED",
    "SCENE_NOT_FOUND",
    "VERSION_MISMATCH",
    "VERSION_GAP",
    "RATE_LIMIT",
    "WRITE_FORBIDDEN",
    "UNKNOWN_PATH",
    "INVALID_VALUE",
    "TEST_SESSION_EXPIRED",
    "INTERNAL",
  ];
  if (typeof code !== "string" || !VALID_CODES.includes(code as ServerErrorCode)) {
    throw new CodecError(`unknown error code : ${String(code)}`, v);
  }
  const message = expectString(v, "message");
  const recoverable = v.recoverable;
  if (typeof recoverable !== "boolean") {
    throw new CodecError("error.recoverable must be a boolean", v);
  }
  return {
    type: "error",
    v: PROTOCOL_VERSION,
    code: code as ServerErrorCode,
    message,
    recoverable,
  };
}

function validatePong(v: Record<string, unknown>): ServerMessage {
  const nonce = expectString(v, "nonce");
  return { type: "pong", v: PROTOCOL_VERSION, nonce };
}

// --- helpers --------------------------------------------------------

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function expectString(v: Record<string, unknown>, key: string): string {
  const got = v[key];
  if (typeof got !== "string") {
    throw new CodecError(`${key} must be a string`, v);
  }
  return got;
}

function expectNumber(v: Record<string, unknown>, key: string): number {
  const got = v[key];
  if (typeof got !== "number" || !Number.isFinite(got)) {
    throw new CodecError(`${key} must be a finite number`, v);
  }
  return got;
}
