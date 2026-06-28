// ADR Blue 009 §3.2 (axe 1, antenne) — viewer-injection sources for the peer
// viewer.
//
// `Solar.mount` reads its receive-only Meet viewer credentials from a page
// global. Until now there was one source : `__ZAB_PEER_VIEWER__`, pinned by the
// Prism scene-server for the PREVIEW webview. ADR Blue 009 §3.2 adds a SECOND
// source for the ANTENNE, where there is no Prism : the SAME viewer data
// (`{ rooms: [...] }`) is carried by Orion's LSDP bundle for the active stream
// and surfaced to the page as `__ZAB_LSDP_PEER_VIEWER__`. Solar does not change
// its join behaviour (receive-only, no identity, never talks to ZabGate) — it
// only gains a second place to read the same shape from.
//
// The LSDP source additionally carries the slot→peer assignment snapshot
// (`__cam.slots.*`, §3.3) as an optional `slots` map, used to re-key
// `x-zab.meet-peer` nodes by `slotRef` (see `slot-binding.ts`).
//
// >>> Chaining debt (signalled to Eleven) : the LSDP-sourced global is populated
//     by the antenne host from Orion's LSDP bundle. That carrier is delivered by
//     Orion #261 (viewer creds on the LSDP) + a Lumencast runtime that exposes
//     LSDP leaves / renders `x-zab.meet-peer`. With the currently vendored
//     runtime (v0.9.0) the global is simply ABSENT on-air → the antenne path is
//     inert and only the preview source is live. Solar reads it defensively so
//     it activates the day the carrier ships, with no further Solar change.

import type { PeerViewerInjection } from "@lumencast/runtime";

/** Prism PREVIEW source — pinned by the scene-server before Solar mounts. Shared
 *  verbatim with Prism's injection ; change it in BOTH places. */
export const ZAB_PEER_VIEWER_GLOBAL = "__ZAB_PEER_VIEWER__";

/** ANTENNE source — pinned by the antenne host from Orion's LSDP bundle (ADR
 *  Blue 009 §3.2). Same `{ rooms, slots? }` shape ; viewer creds are short-TTL,
 *  receive-only (R1, gated by Bastion clearance of ADR 009 #6 / Orion #261). */
export const ZAB_LSDP_PEER_VIEWER_GLOBAL = "__ZAB_LSDP_PEER_VIEWER__";

/** One room's viewer credentials. Mirrors the ZabCam room credentials (#6) ; the
 *  token is the room-level Meet token, NOT an antenne JWT. */
interface PeerViewerRoom {
  signalingUrl: string;
  roomId: string;
  token: string;
}

/** The shape either source may carry : the FINAL multi-room model plus an
 *  optional slot→peer snapshot. The legacy single-room shape (a bare room object)
 *  is still tolerated for the preview source. */
interface ViewerInjectionShape {
  rooms?: unknown;
  slots?: unknown;
}

export interface ResolvedInjection {
  /** The normalised viewer injection to hand the runtime, or `null` when no
   *  usable room is present in EITHER source. Carries `rooms` only — `slots` are
   *  returned separately, never forwarded into the bundle/viewer. */
  injection: PeerViewerInjection | null;
  /** Slot→peer assignment snapshot (the LSDP `__cam.slots.*` subtree). Empty when
   *  absent — `x-zab.meet-peer` slots then render their placeholder. */
  slotBindings: Record<string, string>;
  /** Whether the ANTENNE (LSDP) source contributed usable creds. Gates the
   *  slot-aware re-keying path : preview-only stays byte-identical, the antenne
   *  path activates only once the LSDP creds are effectively present. */
  fromLsdp: boolean;
}

const isUsableRoom = (r: unknown): r is PeerViewerRoom =>
  typeof r === "object" &&
  r !== null &&
  typeof (r as PeerViewerRoom).signalingUrl === "string" &&
  typeof (r as PeerViewerRoom).roomId === "string" &&
  typeof (r as PeerViewerRoom).token === "string" &&
  (r as PeerViewerRoom).signalingUrl !== "" &&
  (r as PeerViewerRoom).roomId !== "";

/** Pull the usable rooms out of one source global (multi-room `{ rooms }` or the
 *  legacy single-room shape). */
function roomsOf(cfg: ViewerInjectionShape | PeerViewerRoom | undefined): PeerViewerRoom[] {
  if (cfg === undefined) return [];
  if ("rooms" in cfg && Array.isArray(cfg.rooms)) return cfg.rooms.filter(isUsableRoom);
  // Legacy single-room shape (preview back-compat).
  return isUsableRoom(cfg) ? [cfg] : [];
}

/** Pull the slot→peer snapshot out of a source global. Only string→string
 *  entries are kept ; anything else is dropped (defensive against a malformed
 *  global). */
function slotsOf(cfg: ViewerInjectionShape | undefined): Record<string, string> {
  const raw = cfg?.slots;
  if (typeof raw !== "object" || raw === null) return {};
  const out: Record<string, string> = {};
  for (const [slotRef, peerLabel] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof peerLabel === "string" && peerLabel !== "") out[slotRef] = peerLabel;
  }
  return out;
}

/** Read the viewer config from BOTH sources (preview global OR/AND LSDP global,
 *  ADR Blue 009 §3.2). Rooms are merged and de-duplicated by `roomId` (a room
 *  pinned by both sources is joined once) ; slot bindings come from the LSDP
 *  source. Returns `injection === null` when neither source carries a usable
 *  room. */
export function readPeerViewerInjection(): ResolvedInjection {
  const g = globalThis as Record<string, unknown>;
  const preview = g[ZAB_PEER_VIEWER_GLOBAL] as ViewerInjectionShape | PeerViewerRoom | undefined;
  const lsdp = g[ZAB_LSDP_PEER_VIEWER_GLOBAL] as ViewerInjectionShape | undefined;

  const merged: PeerViewerRoom[] = [];
  const seen = new Set<string>();
  for (const room of [...roomsOf(preview), ...roomsOf(lsdp)]) {
    if (seen.has(room.roomId)) continue;
    seen.add(room.roomId);
    merged.push(room);
  }

  const lsdpRooms = roomsOf(lsdp);
  return {
    injection: merged.length > 0 ? { rooms: merged } : null,
    slotBindings: slotsOf(lsdp),
    fromLsdp: lsdpRooms.length > 0,
  };
}
