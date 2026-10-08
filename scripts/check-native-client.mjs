import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
const expected = {
  "src/browser.js":
    "b9c61d66f4ac80d1ed70c2f894aa8de91056548274e2f35b963e964297eca85f",
  "src/error.js":
    "53bd68fb8bd16b83cdfa573a5335153c5573609c14e4d46dfb81212cd833c7d1",
  "src/strict-json.js":
    "b715e31adf77a69fd567a7c6dca5cebace20b17319b066adbcfb9b2227f6760e",
  "tree-vectors.json":
    "e4066846f38b9c9c6c2171f008470242334a5660c92c066f91919c688c85237f",
};
for (const [file, digest] of Object.entries(expected)) {
  const bytes = await readFile(
    new URL(`../vendor/lsdp-native-browser/${file}`, import.meta.url),
  );
  if (createHash("sha256").update(bytes).digest("hex") !== digest)
    throw new Error(`Native client provenance mismatch: ${file}`);
}
console.log(
  "Native portable client verified: e695e14f9f664f430ffc2e0e75d083fab88abc7f, 4 exact upstream files.",
);
