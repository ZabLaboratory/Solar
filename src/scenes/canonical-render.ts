import {
  canonicalize,
  withZeroedSceneVersion,
  ZERO_HASH,
} from "@lumencast/canonical";

/** Serialize LSML once, hash its zeroed version, then stamp the root version. */
export async function canonicalRender(
  document: Record<string, unknown>,
): Promise<{
  data: Uint8Array;
  sceneVersion: string;
}> {
  const text = canonicalize(withZeroedSceneVersion(document));
  const data = new TextEncoder().encode(text);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
  const sceneVersion =
    "sha256:" +
    Array.from(digest, (b) => b.toString(16).padStart(2, "0")).join("");
  // Locate the root member, skipping strings and nested containers. Nested
  // scene_version keys and key-shaped string contents must remain untouched.
  let depth = 0;
  for (let i = 0; i < data.length; i++) {
    const byte = data[i];
    if (byte === 123 || byte === 91) depth++;
    else if (byte === 125 || byte === 93) depth--;
    else if (byte === 34) {
      const start = i++;
      while (i < data.length && data[i] !== 34) {
        if (data[i] === 92) i++;
        i++;
      }
      if (
        depth === 1 &&
        data[i + 1] === 58 &&
        new TextDecoder().decode(data.subarray(start, i + 1)) ===
          '"scene_version"'
      ) {
        const offset = i + 3;
        const expected = new TextEncoder().encode(ZERO_HASH);
        if (
          data[i + 2] !== 34 ||
          data[offset + expected.length] !== 34 ||
          expected.some((b, j) => data[offset + j] !== b)
        )
          throw new Error("Invalid canonical LSML version slot.");
        data.set(new TextEncoder().encode(sceneVersion), offset);
        return { data, sceneVersion };
      }
    }
  }
  throw new Error("Canonical LSML root version is missing.");
}
