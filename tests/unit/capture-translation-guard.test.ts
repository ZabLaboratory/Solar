import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { captureTranslationGuard } from "../../src/scenes/capture-translation-guard";

const key = "__editable.63616d.translate";

it("uses identical guards with browser and native SHA-256", () => {
  const browser = captureTranslationGuard(document(), ["cam"]);
  const native = captureTranslationGuard(document(), ["cam"], (data) =>
    createHash("sha256").update(data).digest("hex"),
  );
  expect(native).toEqual(browser);
});
function document() {
  return {
    scene_id: "scene",
    scene_version: "version",
    defaults: { [key]: [1, 2], title: "hello" },
    layout: {
      kind: "frame",
      children: [
        {
          id: "cam",
          kind: "x-zab.capture",
          bindAnimate: { "transform.translate": key },
        },
        { id: "text", kind: "text", value: "hello" },
      ],
    },
  };
}

it("normalizes only isolated capture translations and preserves the rest of the document", () => {
  const original = document();
  const guard = captureTranslationGuard(original, ["cam"]);
  expect(guard?.components).toEqual(["cam"]);
  original.defaults[key] = [200, 300];
  expect(captureTranslationGuard(original, ["cam"])).toEqual(guard);
  original.defaults.title = "changed";
  expect(captureTranslationGuard(original, ["cam"])?.hash).not.toBe(
    guard?.hash,
  );
});

it("refuses other references, aliases, ambiguous owners and invalid translations", () => {
  const extraReference = document();
  extraReference.layout.children[1]!.value = key;
  expect(captureTranslationGuard(extraReference, ["cam"])).toBeNull();
  const embeddedReference = document();
  embeddedReference.layout.children[1]!.value = `prefix ${key}`;
  expect(captureTranslationGuard(embeddedReference, ["cam"])).toBeNull();
  const wrongOwner = document();
  wrongOwner.layout.children[0]!.id = "other";
  expect(captureTranslationGuard(wrongOwner, ["cam"])).toBeNull();
  const invalid = document();
  invalid.defaults[key] = [Number.NaN, 0];
  expect(captureTranslationGuard(invalid, ["cam"])).toBeNull();
  expect(captureTranslationGuard(document(), ["other"])).toBeNull();
});

it("does not hide edits to other properties, the scene, or a reference bundle", () => {
  const base = document();
  const expected = captureTranslationGuard(base, ["cam"]);
  for (const change of [
    (d: ReturnType<typeof document>) => {
      d.scene_id = "other";
    },
    (d: ReturnType<typeof document>) => {
      d.layout.children[1]!.value = "other";
    },
    (d: ReturnType<typeof document>) => {
      d.layout.children.reverse();
    },
    (d: ReturnType<typeof document>) => {
      d.layout.children[0]!.id = "other";
    },
  ]) {
    const current = document();
    change(current);
    expect(captureTranslationGuard(current, ["cam"])?.hash).not.toBe(
      expected?.hash,
    );
  }
  const withBundle = {
    ...document(),
    "x-solar-authoring": { lsml_bundle: document() },
  };
  const bundleGuard = captureTranslationGuard(withBundle, ["cam"]);
  withBundle.defaults[key] = [100, 200];
  expect(captureTranslationGuard(withBundle, ["cam"])).toEqual(bundleGuard);
  withBundle["x-solar-authoring"].lsml_bundle.defaults[key] = [9, 8];
  expect(captureTranslationGuard(withBundle, ["cam"])?.hash).not.toBe(
    bundleGuard?.hash,
  );
});
