const MAX_FONTS = 64;
const MAX_FONT_BYTES = 64 * 1024 * 1024;

// Font assets are loaded once, before scene admission, never during mutation.
export async function fetchFonts(fetcher) {
  const manifest = await fetcher("/fonts", { cache: "no-store" });
  if (manifest.status === 404) {
    const response = await fetcher("/font", { cache: "no-store" });
    if (response.status === 204) return [];
    return [await readFont(response, MAX_FONT_BYTES)];
  }
  if (!manifest.ok) throw new Error(`Font manifest request failed with HTTP ${manifest.status}.`);
  const paths = await manifest.json();
  if (!Array.isArray(paths) || paths.length > MAX_FONTS || paths.some((path,index) => path !== `/fonts/${index}`)) {
    throw new Error("Invalid same-origin font asset manifest.");
  }
  const fonts = [];
  let total = 0;
  for (const path of paths) {
    const response = await fetcher(path, { cache: "no-store" });
    const bytes = await readFont(response, MAX_FONT_BYTES - total);
    total += bytes.byteLength;
    fonts.push(bytes);
  }
  return fonts;
}

async function readFont(response, remaining) {
  if (!response.ok) throw new Error(`Font request failed with HTTP ${response.status}.`);
  const declared = response.headers?.get?.("content-length");
  if (declared !== null && declared !== undefined && Number(declared) > remaining) {
    throw new Error("Font assets exceed 64 MiB.");
  }
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.byteLength > remaining) throw new Error("Font assets exceed 64 MiB.");
  return bytes;
}

export function fontFactory(Engine, method, fonts) {
  const multiple = `${method}_with_fonts`;
  if (typeof Engine[multiple] === "function") return (...args) => Engine[multiple](args[0], fonts, ...args.slice(1));
  if (fonts.length > 1) throw new Error("The fixed WASM engine cannot admit multiple supplied fonts.");
  return (...args) => Engine[method](args[0], fonts[0] ?? new Uint8Array(), ...args.slice(1));
}
