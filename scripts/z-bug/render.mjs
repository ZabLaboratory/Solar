// Render the native Solar canvas at fixed timeline positions. The PNG alpha is
// read from the actual Vision canvas, not inferred from a black screenshot.
import { createRequire } from "node:module";
import { mkdir, writeFile, copyFile, readdir, unlink } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "../..");
const require = createRequire(resolve(process.env.SPONSOR_PLAYWRIGHT_ROOT ?? root, "package.json"));
const { chromium } = require("playwright");
const port = Number(process.env.SPONSOR_MOTION_PORT ?? 4640);
const origin = `http://127.0.0.1:${port}`;
const frames = resolve(root, ".cache/z-bug/frames");
const deliverable = resolve(process.argv[2] ?? "");
if (!process.argv[2]) throw Error("Usage: node scripts/z-bug/render.mjs <explicit-deliverable-directory>");
await mkdir(frames, { recursive: true });
for (const name of await readdir(frames))
  if (/^frame-\d{4}\.png$/.test(name)) await unlink(resolve(frames, name));
await mkdir(deliverable, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true });
const page = await browser.newPage({ viewport: { width: 1360, height: 980 } });
const errors = [];
page.on("pageerror", error => errors.push(error.message));
await page.addInitScript(() => document.addEventListener("solar:lsdp-applied", event => {
  globalThis.__renderReceipts ??= [];
  globalThis.__renderReceipts.push(event.detail);
}, true));
try {
  await page.goto(origin);
  await page.waitForFunction(() => !document.querySelector("#play").disabled, null, { timeout: 45000 });
  const frame = page.frames().find(f => f.url().startsWith(`http://127.0.0.1:${port + 1}/host.html`));
  if (!frame) throw Error("Solar iframe unavailable");
  const canvas = frame.locator("#scene canvas[aria-hidden=true]").last();
  const command = async body => {
    const response = await fetch(`${origin}/play`, {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
    });
    if (!response.ok) throw Error(await response.text());
    const result = await response.json();
    const id = result.receipt.receipt.transactionId;
    await frame.waitForFunction(value => globalThis.__renderReceipts?.some(receipt => receipt.transactionId === value), id, { timeout: 15000 });
  };
  await command({ action: "pause" });
  const fps = 60, duration_ms = 4500, motion_ms = 2734;
  const total = Math.round(duration_ms / 1000 * fps);
  const animated = Math.round(motion_ms / 1000 * fps) + 1;
  for (let i = 0; i < animated; i++) {
    const time_ms = i * 1000 / fps;
    await command({ action: "seek", time_ms });
    const data = await canvas.evaluate(node => node.toDataURL("image/png"));
    await writeFile(resolve(frames, `frame-${String(i).padStart(4, "0")}.png`), Buffer.from(data.split(",")[1], "base64"));
    if (i % 30 === 0) console.log(`Solar vector frame ${i}/${total}`);
  }
  const finalFrame = resolve(frames, `frame-${String(animated - 1).padStart(4, "0")}.png`);
  await copyFile(finalFrame, resolve(deliverable, "z-final-transparent.png"));
  for (let i = animated; i < total; i++)
    await copyFile(finalFrame, resolve(frames, `frame-${String(i).padStart(4, "0")}.png`));
  await command({ action: "cancel" });
  if (errors.length) throw Error(`Browser errors: ${errors.join(" | ")}`);
  await writeFile(resolve(deliverable, "render.json"), JSON.stringify({
    source: "Solar native LSML + Vision canvas", fps, duration_ms, animated,
    total, alpha: "canvas PNG alpha preserved", errors,
  }, null, 2));
  console.log(JSON.stringify({ frames, deliverable, fps, animated, total, errors }));
} finally {
  await browser.close();
}
