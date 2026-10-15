import { createHash } from "node:crypto";
import { deflateSync } from "node:zlib";
import { bundleAddress, canonicalize } from "@lumencast/canonical";
import { zipSync } from "fflate";
import { writeFile } from "node:fs/promises";

const crcTable = Uint32Array.from({ length: 256 }, (_, seed) => {
  let crc = seed;
  for (let bit = 0; bit < 8; bit++)
    crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
  return crc >>> 0;
});

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name, data) {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4);
  length.writeUInt32BE(data.length);
  const crcInput = Buffer.concat([type, data]);
  const checksum = Buffer.alloc(4);
  checksum.writeUInt32BE(crc32(crcInput));
  return Buffer.concat([length, type, data, checksum]);
}

function solidPng(color, size = 16) {
  const { r, g, b, a } = color;
  const scanline = Buffer.alloc(1 + size * 4);
  scanline[0] = 0;
  for (let x = 0; x < size; x++) {
    const offset = 1 + x * 4;
    scanline[offset] = r;
    scanline[offset + 1] = g;
    scanline[offset + 2] = b;
    scanline[offset + 3] = a;
  }
  const pixels = Buffer.concat(Array.from({ length: size }, () => scanline));
  const header = Buffer.alloc(13);
  header.writeUInt32BE(size, 0);
  header.writeUInt32BE(size, 4);
  header[8] = 8;
  header[9] = 6;
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    signature,
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

function imageColor(index) {
  const value = index - 1;
  return { r: value & 0xff, g: (value >>> 8) & 0xff, b: 199, a: 255 };
}

function sha1(bytes) {
  return createHash("sha1").update(bytes).digest("hex");
}

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

/** Build one immutable LSMLZ origin plus distinct bounded HTTP PNG fixtures. */
export async function createImageLifetimeFixture({
  count,
  scenePath,
  sceneSourcePath,
  initialImagePath,
}) {
  const sourceImage = solidPng({ r: 0, g: 0, b: 255, a: 255 });
  const sourceSha1 = sha1(sourceImage);
  const sourcePath = `assets/${sourceSha1}.png`;
  const dynamicImages = new Map();
  for (let index = 1; index <= count + 3; index++) {
    const color = imageColor(index);
    const bytes = solidPng(color);
    dynamicImages.set(index, {
      index,
      color,
      bytes,
      sha256: sha256(bytes),
    });
  }

  const document = {
    lsml: "1.1",
    scene_id: "image-lifetime-private-qualification",
    scene_version: "",
    viewport: { width: 256, height: 256 },
    assets: { allowedHosts: ["127.0.0.1"] },
    defaults: { logo: sourcePath },
    layout: {
      kind: "frame",
      id: "image-lifetime-root",
      size: { w: 256, h: 256 },
      background: "#000000",
      children: [
        {
          kind: "image",
          id: "dynamic-image",
          position: { x: 0, y: 0 },
          size: { w: 256, h: 256 },
          fit: "fill",
          bind: { src: "logo" },
        },
      ],
    },
  };
  document.scene_version = await bundleAddress(document);
  const sourceBytes = Buffer.from(canonicalize(document), "utf8");
  const archiveBytes = zipSync(
    { "scene.lsml": sourceBytes, [sourcePath]: sourceImage },
    { level: 0, mtime: new Date("1980-01-01T00:00:00.000Z") },
  );
  await Promise.all([
    writeFile(scenePath, archiveBytes),
    writeFile(sceneSourcePath, sourceBytes),
    writeFile(initialImagePath, sourceImage),
  ]);
  return {
    document,
    sourceImage,
    sourcePath,
    sourceSha1,
    dynamicImages,
    sourceBytes,
    archiveBytes,
  };
}
