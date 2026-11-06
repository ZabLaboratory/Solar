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
