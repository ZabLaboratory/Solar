import { VerifiedFont } from "../scenes/verified-font";

// Published LSML may name the shared editor families without embedding them.
// Admit the licensed host faces once, alongside any scene-owned font assets.
const hostFonts = [
  "geist-latin.woff2",
  "geist-mono-latin.woff2",
  "figtree-variable.ttf",
  "alex-brush-400.woff2",
  "ibm-plex-mono-400.woff2",
  "ibm-plex-mono-500.woff2",
  "ibm-plex-mono-600.woff2",
  "space-grotesk-400.woff2",
  "space-grotesk-500.woff2",
  "space-grotesk-600.woff2",
  "space-grotesk-700.woff2",
];
let hostFontBytes: Promise<Uint8Array[]> | null = null;
export function loadHostFonts(): Promise<Uint8Array[]> {
  hostFontBytes ??= Promise.all(
    hostFonts.map(async (path) => {
      const response = await fetch(new URL(`fonts/${path}`, document.baseURI));
      if (!response.ok) throw new Error(`Solar host font unavailable: ${path}`);
      return new Uint8Array(await response.arrayBuffer());
    }),
  ).catch((error) => {
    hostFontBytes = null;
    throw error;
  });
  return hostFontBytes;
}

/** The legacy presenter font URLs share the persistent host font admission bytes. */
export async function visionFontResponse(
  input: string,
  sceneFonts: Array<Uint8Array | VerifiedFont>,
): Promise<Response | null> {
  if (input === "/fonts")
    return Response.json(
      [...hostFonts, ...sceneFonts].map((_, index) => "/fonts/" + index),
    );
  if (!input.startsWith("/fonts/")) return null;
  const index = Number(input.slice(7));
  const bytes = Number.isInteger(index)
    ? [
        ...(await loadHostFonts()),
        ...sceneFonts.map((font) =>
          VerifiedFont.isVerified(font) ? font.copy() : font,
        ),
      ][index]
    : undefined;
  return bytes
    ? new Response(new Uint8Array(bytes), { status: 200 })
    : new Response(null, { status: 404 });
}
