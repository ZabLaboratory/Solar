import { isImmutableNativeValue } from "../internal/native-state";
import { canonicalize } from "@lumencast/canonical";
import { sha256 } from "@noble/hashes/sha256";
import { bytesToHex } from "@noble/hashes/utils";

export interface CaptureTranslationGuard {
  version: "capture-translation/1";
  components: string[];
  hash: string;
}

const record = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;

/**
 * Permit only editor-owned capture translations that are referenced solely as
 * that capture's animate translation. All other document bytes remain in the
 * digest. An unsupported or ambiguous document has no fast-path guard.
 */
export function captureTranslationGuard(
  value: unknown,
  requestedIds: readonly string[],
  digest: (data: Uint8Array) => string = (data) => bytesToHex(sha256(data)),
): CaptureTranslationGuard | null {
  const document = record(value);
  const defaults = record(document?.defaults);
  if (!document || !defaults || !record(document.layout)) return null;
  const candidates = [...new Set(requestedIds)].sort().flatMap((id) => {
    if (!id || id.length > 256) return [];
    const token = bytesToHex(new TextEncoder().encode(id));
    const key = `__editable.${token}.translate`;
    const translation = defaults[key];
    return Array.isArray(translation) &&
      translation.length === 2 &&
      translation.every(
        (n: unknown) => typeof n === "number" && Number.isFinite(n),
      )
      ? [{ id, key, layoutCount: 0, unsafe: false }]
      : [];
  });
  if (!candidates.length) return null;
  const visit = (
    current: unknown,
    path: string[],
    parent: Record<string, unknown> | null,
    owner: Record<string, unknown> | null,
    name: string,
  ): void => {
    if (typeof current === "string") {
      for (const candidate of candidates) {
        if (!current.includes(candidate.key)) continue;
        const allowed =
          current === candidate.key &&
          name === "transform.translate" &&
          parent === owner?.bindAnimate &&
          owner?.id === candidate.id &&
          owner.kind === "x-zab.capture";
        if (!allowed) candidate.unsafe = true;
        else if (path[0] === "layout") candidate.layoutCount++;
      }
      return;
    }
    if (!current || typeof current !== "object") return;
    if (Array.isArray(current)) {
      current.forEach((child, index) =>
        visit(child, [...path, String(index)], null, owner, String(index)),
      );
      return;
    }
    const object = current as Record<string, unknown>;
    for (const [key, child] of Object.entries(object)) {
      for (const candidate of candidates) {
        if (!key.includes(candidate.key)) continue;
        const isDefaults =
          key === candidate.key &&
          (path.join(".") === "defaults" ||
            path.join(".") === "x-solar-authoring.lsml_bundle.defaults");
        if (!isDefaults) candidate.unsafe = true;
      }
      visit(
        child,
        [...path, key],
        object,
        key === "bindAnimate" ? object : owner,
        key,
      );
    }
  };
  visit(document, [], null, null, "");
  const eligible = candidates.filter(
    (item) => !item.unsafe && item.layoutCount === 1,
  );
  if (!eligible.length) return null;
  const normalizedDefaults = { ...defaults };
  for (const item of eligible) normalizedDefaults[item.key] = [0, 0];
  const normalized = { ...document, defaults: normalizedDefaults };
  return {
    version: "capture-translation/1",
    components: eligible.map((item) => item.id),
    hash: `sha256:${digest(new TextEncoder().encode(canonicalize(normalized)))}`,
  };
}

/** One publisher can reuse the verified digest across immutable path copies
 * when every changed leaf is masked by that exact digest. */
export function activeCaptureTranslationGuard(
  digest?: (data: Uint8Array) => string,
) {
  let previous:
    | {
        document: WeakRef<Record<string, unknown>>;
        requested: string[];
        keys: Set<string>;
        guard: CaptureTranslationGuard;
      }
    | undefined;
  return (
    document: Record<string, unknown>,
    ids: string[],
  ): CaptureTranslationGuard | null => {
    const owned = isImmutableNativeValue(document);
    const cached = previous;
    const prior = cached?.document.deref();
    const defaults = record(document.defaults);
    const before = record(prior?.defaults);
    if (
      owned &&
      prior &&
      cached &&
      defaults &&
      before &&
      ids.length === cached.requested.length &&
      ids.every((id, i) => id === cached.requested[i]) &&
      Object.keys(prior).length === Object.keys(document).length &&
      Object.keys(document).every(
        (key) =>
          Object.hasOwn(prior, key) &&
          (key === "defaults" || Object.is(document[key], prior[key])),
      ) &&
      Object.keys(before).length === Object.keys(defaults).length &&
      Object.entries(defaults).every(
        ([key, value]) =>
          Object.hasOwn(before, key) &&
          (Object.is(value, before[key]) ||
            (cached.keys.has(key) &&
              Array.isArray(value) &&
              value.length === 2 &&
              value.every((n) => typeof n === "number" && Number.isFinite(n)))),
      )
    ) {
      cached.document = new WeakRef(document);
      return cached.guard;
    }
    const guard = captureTranslationGuard(document, ids, digest);
    previous =
      owned && guard
        ? {
            document: new WeakRef(document),
            requested: [...ids],
            keys: new Set(
              guard.components.map(
                (id) =>
                  "__editable." +
                  bytesToHex(new TextEncoder().encode(id)) +
                  ".translate",
              ),
            ),
            guard,
          }
        : undefined;
    return guard;
  };
}
