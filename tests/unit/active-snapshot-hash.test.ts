import { expect, it } from "vitest";
import { nativeTreeHash } from "../../src/internal/native-tree";
import { ActiveSnapshotHash } from "../../src/server/active-snapshot-hash";

it("validates fresh snapshots and matches the normative digest across edits and scene replacement", () => {
  const hashes = new ActiveSnapshotHash();
  const document = {
    scene_id: "first",
    scene_version: "one",
    layout: {
      children: Array.from({ length: 80 }, (_, id) => ({ id, text: "stable" })),
    },
    defaults: { x: 0 },
  };
  const before = JSON.stringify(document);
  for (let i = 0; i < 40; i++) {
    document.defaults.x = i;
    expect(hashes.hash("solar/lane-a", document, true)).toBe(
      nativeTreeHash(document),
    );
  }
  document.defaults.x = 0;
  expect(JSON.stringify(document)).toBe(before);
  expect(Object.isFrozen(document.layout)).toBe(false);
  document.scene_id = "next";
  document.layout.children[0]!.text = "changed";
  expect(hashes.hash("solar/lane-a", document, true)).toBe(
    nativeTreeHash(document),
  );
  expect(hashes.hash("solar/lane-a", null, true)).toBe(nativeTreeHash(null));
  expect(() =>
    hashes.hash(
      "solar/lane-a",
      { ...document, invalid: 9007199254740992 },
      true,
    ),
  ).toThrow();
  hashes.clear();
  expect(hashes.hash("solar/lane-a", document, true)).toBe(
    nativeTreeHash(document),
  );
});

it("hashes validated mutable LSDP reads without trusting prior object identities", () => {
  const hashes = new ActiveSnapshotHash();
  const document = {
    scene_id: "one",
    scene_version: "version",
    layout: { text: "x".repeat(2000) },
    defaults: { translate: [1, 2] },
  };
  for (let i = 0; i < 20; i++) {
    document.defaults.translate[0] = i;
    if (i === 7) document.layout.text = "short";
    if (i === 14) document.layout.text = "x".repeat(2000);
    expect(hashes.hash("solar/lane-b", document, true, true)).toBe(
      nativeTreeHash(document),
    );
  }
  expect(Object.isFrozen(document)).toBe(false);
  expect(hashes.hash("solar/lane-b", document, true)).toBe(
    nativeTreeHash(document),
  );
});
