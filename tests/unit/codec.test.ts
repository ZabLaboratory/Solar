import { describe, expect, it } from "vitest";
import { CodecError, decode, encode } from "../../src/transport/codec";
import { PROTOCOL_VERSION } from "../../src/transport/protocol";

describe("decode() — server messages", () => {
  it("accepts a valid snapshot", () => {
    const raw = JSON.stringify({
      type: "snapshot",
      v: PROTOCOL_VERSION,
      scene_id: "scene-42",
      scene_version: "sha256:abc",
      sequence: 12345,
      state: { "score.team_a": 14, "logo.visible": true },
    });
    const msg = decode(raw);
    expect(msg).toMatchObject({
      type: "snapshot",
      scene_id: "scene-42",
      sequence: 12345,
    });
  });

  it("accepts a delta with a typed transition", () => {
    const raw = JSON.stringify({
      type: "delta",
      v: PROTOCOL_VERSION,
      scene_id: "scene-42",
      sequence: 12346,
      patches: [
        {
          path: "score.team_a",
          value: 15,
          transition: { kind: "tween", duration_ms: 200, ease: "cubic-out" },
        },
      ],
    });
    const msg = decode(raw);
    if (msg.type !== "delta") throw new Error("expected delta");
    expect(msg.patches).toHaveLength(1);
    const patch = msg.patches[0]!;
    expect(patch.path).toBe("score.team_a");
    expect(patch.transition).toMatchObject({ kind: "tween", duration_ms: 200 });
  });

  it("accepts a scene_changed with crossfade", () => {
    const raw = JSON.stringify({
      type: "scene_changed",
      v: PROTOCOL_VERSION,
      from_scene_id: "a",
      to_scene_id: "b",
      transition: { kind: "crossfade", duration_ms: 600 },
    });
    const msg = decode(raw);
    expect(msg.type).toBe("scene_changed");
  });

  it("accepts an error message", () => {
    const raw = JSON.stringify({
      type: "error",
      v: PROTOCOL_VERSION,
      code: "AUTH_DENIED",
      message: "go away",
      recoverable: false,
    });
    const msg = decode(raw);
    if (msg.type !== "error") throw new Error("expected error");
    expect(msg.code).toBe("AUTH_DENIED");
    expect(msg.recoverable).toBe(false);
  });

  it("rejects malformed JSON", () => {
    expect(() => decode("not json")).toThrow(CodecError);
  });

  it("rejects an unknown type", () => {
    const raw = JSON.stringify({ type: "totally-fake", v: PROTOCOL_VERSION });
    expect(() => decode(raw)).toThrow(/unknown server message type/);
  });

  it("rejects a version mismatch", () => {
    const raw = JSON.stringify({
      type: "pong",
      v: 99,
      nonce: "n",
    });
    expect(() => decode(raw)).toThrow(/protocol version mismatch/);
  });

  it("rejects a delta with a non-string path", () => {
    const raw = JSON.stringify({
      type: "delta",
      v: PROTOCOL_VERSION,
      scene_id: "s",
      sequence: 1,
      patches: [{ path: 42, value: 0 }],
    });
    expect(() => decode(raw)).toThrow(/path must be a string/);
  });

  it("rejects an unknown transition kind", () => {
    const raw = JSON.stringify({
      type: "delta",
      v: PROTOCOL_VERSION,
      scene_id: "s",
      sequence: 1,
      patches: [
        {
          path: "p",
          value: 1,
          transition: { kind: "warp" },
        },
      ],
    });
    expect(() => decode(raw)).toThrow(/unknown transition kind/);
  });
});

describe("encode() — client messages", () => {
  it("round-trips a subscribe", () => {
    const out = encode({
      type: "subscribe",
      v: PROTOCOL_VERSION,
      since_sequence: 1234,
    });
    expect(JSON.parse(out)).toEqual({
      type: "subscribe",
      v: PROTOCOL_VERSION,
      since_sequence: 1234,
    });
  });

  it("round-trips an input with client_msg_id", () => {
    const out = encode({
      type: "input",
      v: PROTOCOL_VERSION,
      path: "match.id",
      value: "match-7",
      client_msg_id: "uuid",
    });
    const parsed = JSON.parse(out);
    expect(parsed.type).toBe("input");
    expect(parsed.client_msg_id).toBe("uuid");
  });
});
