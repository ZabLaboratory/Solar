import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
// A persistent ZabCam room can be re-minted after Meet restarts.  The two
// local Solar documents (Preview and the live browser_source) must not blank
// while their receive-only viewer moves from the stale room to the replacement.
// Runtime 0.18.2 closes removed meshes before it opens the new ones and keeps a
// first-connected-wins registry, which creates exactly that visible gap.  Open
// replacement meshes first and let their first track take ownership; close the
// old generation only after the new WebSocket joins.  This is a receive-side
// handoff only: no Pulsar/Program transport is changed.
async function patchSeamlessRoomHandoff(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  if (source.includes("preferredViewers") || source.includes("h.has(l)"))
    return;
  {
    source = source
      .replace(
        "    const owners = new Map();\n",
        "    const owners = new Map();\n    const preferredViewers = new Set();\n",
      )
      .replace(
        "            if (owner === undefined) {\n                owners.set(label, viewer);\n                return true;\n            }\n            return owner === viewer; // only the owning room may publish/withdraw",
        "            if (owner === undefined || owner === viewer || preferredViewers.has(viewer)) {\n                owners.set(label, viewer);\n                return true;\n            }\n            return false; // only the owner or a preferred handoff may publish/withdraw",
      )
      .replace(
        "        mesh.viewer.leave();\n",
        "        preferredViewers.delete(mesh.viewer);\n        mesh.viewer.leave();\n",
      )
      .replace(
        `            const next = new Set(rooms.map((r) => r.roomId));
            // Close rooms no longer present.
            for (const roomId of [...meshes.keys()]) {
                if (!next.has(roomId))
                    closeRoom(roomId);
            }
            // Open + join rooms newly added.
            const added = [];
            for (const room of rooms) {
                if (!meshes.has(room.roomId)) {
                    openRoom(room);
                    const m = meshes.get(room.roomId);
                    if (m)
                        added.push(m.viewer);
                }
            }
            await Promise.all(added.map((v) => v.join()));`,
        `            const next = new Set(rooms.map((r) => r.roomId));
            const hadMeshes = meshes.size > 0;
            const added = [];
            for (const room of rooms) {
                if (!meshes.has(room.roomId)) {
                    openRoom(room);
                    const m = meshes.get(room.roomId);
                    if (m) {
                        if (hadMeshes)
                            preferredViewers.add(m.viewer);
                        added.push(m.viewer);
                    }
                }
            }
            await Promise.all(added.map((v) => v.join()));
            for (const roomId of [...meshes.keys()]) {
                if (!next.has(roomId))
                    closeRoom(roomId);
            }`,
      );
  }
  if (source === before) return;
  await writeFile(path, source);
}
// Preserve the old peer owner until a preferred replacement emits video.
async function patchHandoffPeerLeave(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  {
    if (!source.includes("claim.preserve?.(key, viewer)")) {
      const needle =
        "        if (activePeerIds.get(key) === e.peerId && claim.acquire(key, viewer)) {";
      const replacement = [
        "        if (activePeerIds.get(key) === e.peerId && claim.preserve?.(key, viewer) === true) return;",
        needle,
      ].join("\n");
      if (!source.includes(needle)) {
        throw new Error(
          `unsupported @lumencast/runtime peer handoff contract: ${path}`,
        );
      }
      source = source.replace(needle, replacement);
    }
    const claimNeedle = [
      "        release: (label, viewer) => {",
      "            if (owners.get(label) === viewer)",
      "                owners.delete(label);",
      "        },",
    ].join("\n");
    const claimReplacement = [
      claimNeedle,
      "        preserve: (_label, viewer) => [...preferredViewers].some((candidate) => candidate !== viewer),",
      ...[],
    ].join("\n");
    if (!source.includes("preserve: (_label")) {
      if (!source.includes(claimNeedle)) {
        throw new Error(
          `unsupported @lumencast/runtime peer claim contract: ${path}`,
        );
      }
      source = source.replace(claimNeedle, claimReplacement);
    }
    if (source !== before) await writeFile(path, source);
    return;
  }
}
// Credential rotation can keep the same opaque room id.  The first handoff
// patch above fixes room-id replacement, but the published runtime map is also
// keyed by room id, so the full receive-side generation swap is applied here
// for the consumed receive-only entry. This remains a
// viewer-only change: old meshes stay visible until replacement labels arrive.
async function patchCredentialHandoff(path) {
  let source = await readFile(path, "utf8");
  const before = source;
  const jsManagement = String.raw`    // roomId → { viewer, fingerprint }
    const meshes = new Map();
    // peer_label → owning viewer (first-connected-wins).
    const owners = new Map();
    const preferredViewers = new Set();
    const claim = {
        acquire: (label, viewer) => {
            const owner = owners.get(label);
            if (owner === undefined || owner === viewer || preferredViewers.has(viewer)) {
                owners.set(label, viewer);
                return true;
            }
            return false;
        },
        release: (label, viewer) => {
            if (owners.get(label) === viewer)
                owners.delete(label);
        },
        preserve: (_label, viewer) => [...preferredViewers].some((candidate) => candidate !== viewer),
    };
    const roomFingerprint = (room) => JSON.stringify([room.roomId, room.signalingUrl, room.token]);
    function createRoomMesh(room) {
        const viewer = new MeetViewer({
            name: room.name ?? "solar-viewer",
            ...room,
            ...(options.deps !== undefined && room.deps === undefined ? { deps: options.deps } : {}),
        });
        wireViewer(viewer, registry, claim);
        return { viewer, fingerprint: roomFingerprint(room) };
    }
    function openRoom(room) {
        if (meshes.has(room.roomId))
            return;
        meshes.set(room.roomId, createRoomMesh(room));
    }
    function closeMesh(mesh) {
        for (const [label, owner] of [...owners.entries()]) {
            if (owner === mesh.viewer) {
                registry.remove(label);
                owners.delete(label);
            }
        }
        preferredViewers.delete(mesh.viewer);
        mesh.viewer.leave();
    }
    function closeRoom(roomId) {
        const mesh = meshes.get(roomId);
        if (mesh === undefined)
            return;
        closeMesh(mesh);
        meshes.delete(roomId);
    }
    function scheduleHandoffClose(oldMesh, replacements) {
        const oldLabels = [...owners.entries()]
            .filter(([, owner]) => owner === oldMesh.viewer)
            .map(([label]) => label);
        if (oldLabels.length === 0 || replacements.length === 0) {
            closeMesh(oldMesh);
            return;
        }
        const deadline = Date.now() + 5_000;
        const poll = () => {
            const ready = oldLabels.every((label) => {
                const owner = owners.get(label);
                return owner !== oldMesh.viewer && owner !== undefined && replacements.includes(owner);
            });
            if (ready || Date.now() >= deadline) {
                closeMesh(oldMesh);
                return;
            }
            setTimeout(poll, 25);
        };
        poll();
    }
`;
  const managementPattern =
    / {4}\/\/ roomId → \{ viewer, joined \}[\s\S]*?\r?\n {4}\}\r?\n(?= {4}for \(const room of options\.rooms\)\s+openRoom\(room\);)/;
  source = source.replace(managementPattern, jsManagement);
  const jsSetRooms = String.raw`    setRooms: async (rooms) => {
        const next = new Set(rooms.map((r) => r.roomId));
        const hadMeshes = meshes.size > 0;
        const added = [];
        const addedRoomIds = [];
        const replaced = [];
        for (const room of rooms) {
            const current = meshes.get(room.roomId);
            if (current === undefined) {
                const nextMesh = createRoomMesh(room);
                meshes.set(room.roomId, nextMesh);
                if (hadMeshes)
                    preferredViewers.add(nextMesh.viewer);
                added.push(nextMesh.viewer);
                addedRoomIds.push(room.roomId);
            }
            else if (current.fingerprint !== roomFingerprint(room)) {
                const nextMesh = createRoomMesh(room);
                meshes.set(room.roomId, nextMesh);
                preferredViewers.add(nextMesh.viewer);
                added.push(nextMesh.viewer);
                replaced.push({ roomId: room.roomId, old: current, next: nextMesh });
            }
        }
        try {
            await Promise.all(added.map((v) => v.join()));
        }
        catch (error) {
            for (const item of replaced) {
                if (meshes.get(item.roomId)?.viewer === item.next.viewer) {
                    closeMesh(item.next);
                    meshes.set(item.roomId, item.old);
                }
            }
            for (const roomId of addedRoomIds) {
                const mesh = meshes.get(roomId);
                if (mesh && added.includes(mesh.viewer))
                    closeRoom(roomId);
            }
            throw error;
        }
        for (const item of replaced)
            scheduleHandoffClose(item.old, [item.next.viewer]);
        for (const roomId of [...meshes.keys()]) {
            if (!next.has(roomId)) {
                const old = meshes.get(roomId);
                meshes.delete(roomId);
                if (old)
                    scheduleHandoffClose(old, added);
            }
        }
    },
`;
  const setRoomsPattern =
    / {4}setRooms: async \(rooms\) => \{[\s\S]*?\r?\n {4}\},\r?\n(?= {4}resolvePeerStream)/;
  source = source.replace(setRoomsPattern, jsSetRooms);
  if (source !== before) await writeFile(path, source);
}
export async function patchRooms(runtimeRoot) {
  await patchSeamlessRoomHandoff(
    join(runtimeRoot, "dist", "webrtc", "index.js"),
  );
  await patchHandoffPeerLeave(join(runtimeRoot, "dist", "webrtc", "index.js"));
  await patchCredentialHandoff(join(runtimeRoot, "dist", "webrtc", "index.js"));
}
