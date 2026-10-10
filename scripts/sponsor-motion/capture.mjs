/* global document, window, requestAnimationFrame, MediaRecorder */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(resolve(process.env.SPONSOR_PLAYWRIGHT_ROOT ?? process.cwd(), "package.json"));
const { chromium } = require("playwright");
const root = resolve(import.meta.dirname, "../..");
const port = Number(process.env.SPONSOR_MOTION_PORT ?? 4550);
const origin = `http://127.0.0.1:${port}`, solarOrigin = `http://127.0.0.1:${port + 1}`;
const out = resolve(root, process.argv[2] ?? "evidence/local-20261010-sponsor-motion/eleven");
const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d+Z$/, "Z");
const output = name => resolve(out, `${stamp}-${name}`);
await mkdir(out, { recursive: true });
const browser = await chromium.launch({ channel: "chrome", headless: true, args: ["--disable-background-timer-throttling", "--disable-renderer-backgrounding"] });
const catalogue = await (await fetch(`${origin}/catalogue`)).json();
const page = await browser.newPage({ viewport: { width: Math.max(800,(catalogue.width ?? 720)+80), height: Math.max(930,(catalogue.height ?? 720)+240) }, deviceScaleFactor: 1 });
const errors = [], consoleMessages = [];
page.on("pageerror", e => errors.push(e.message));
page.on("console", e => { if (e.type() === "error") consoleMessages.push(e.text()); });
await page.route("**/vision/ui/mainpresenter.mjs", async route => {
  const response = await route.fetch();
  const body = (await response.text())
    .replace("function postMessage(request) {", "function postMessage(request) { globalThis.__motionRequests ??= []; globalThis.__motionRequests.push({type:request.type,t:performance.now()});")
    .replace("function emit(message) {", "function emit(message) { if(message.type==='frame-submitted'){globalThis.__motionSubmissions ??= []; globalThis.__motionSubmissions.push({t:performance.now(),seq:message.seq,timing:message.timing});}");
  await route.fulfill({ response, body });
});
try {
  await page.goto(origin);
  await page.waitForFunction(() => !document.querySelector("#play").disabled, null, { timeout: 45000 });
  const solar = page.frames().find(frame => frame.url().startsWith(`${solarOrigin}/host.html`));
  if (!solar) throw Error("Solar frame missing");
  const front = solar.locator("#scene canvas[aria-hidden=true]").last();
  await front.screenshot({ path: output("before.png") });
  const baseline = await solar.evaluate(() => globalThis.__motionRequests ?? []);
  await solar.evaluate(({interval,codec}) => {
    const canvas = [...document.querySelectorAll("#scene canvas[aria-hidden=true]")].at(-1);
    const frames = [], context = canvas.getContext("2d");
    globalThis.__motionFrames = frames;
    let lastSample=-Infinity;
    const sample = now => { if(now-lastSample>=interval){lastSample=now;const pixels=context.getImageData(0,0,canvas.width,canvas.height);let sum=0;for(let i=0;i<pixels.data.length;i+=4096)sum=(sum*31+pixels.data[i]+pixels.data[i+1]*3+pixels.data[i+2]*7)>>>0;frames.push({t:performance.now(),hash:sum});}if(globalThis.__recording)requestAnimationFrame(sample); };
    globalThis.__recording = true; requestAnimationFrame(sample);
    const recorder = new MediaRecorder(canvas.captureStream(60), { mimeType: `video/webm;codecs=${codec}`, videoBitsPerSecond: 10000000 });
    const chunks=[]; recorder.ondataavailable=e=>chunks.push(e.data);
    globalThis.__stopRecording=()=>new Promise(resolve=>{recorder.onstop=async()=>{globalThis.__recording=false;const bytes=new Uint8Array(await new Blob(chunks,{type:'video/webm'}).arrayBuffer());let text='';for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));resolve(btoa(text));};recorder.stop();});
    recorder.start();
  }, {interval:catalogue.capture?.fingerprint_interval_ms ?? 0,codec:catalogue.capture?.codec ?? "vp9"});
  await page.waitForTimeout(700);
  const play = page.evaluate(() => window.playMotion());
  await page.waitForFunction(() => Boolean(window.lastCommand));
  await page.waitForTimeout(catalogue.duration_ms * .5);
  await front.screenshot({ path: output("middle.png") });
  const command = await play;
  await page.waitForTimeout(800);
  await front.screenshot({ path: output("after.png") });
  const video = await solar.evaluate(() => globalThis.__stopRecording());
  await writeFile(output(`${catalogue.slug ?? "sponsor-motion"}.webm`), Buffer.from(video, "base64"));
  const after = await solar.evaluate(() => ({ requests: globalThis.__motionRequests, submissions: globalThis.__motionSubmissions, frames: globalThis.__motionFrames, width: document.querySelector('#scene canvas[aria-hidden=true]').width, height: document.querySelector('#scene canvas[aria-hidden=true]').height }));
  // Exclude the initial loaded scene. The remaining submissions cover this play,
  // including its command frame and final frame, never the idle capture margins.
  const submitted = after.submissions.slice(1);
  const intervals = submitted.slice(1).map((entry, index) => entry.t - submitted[index].t).sort((a, b) => a - b);
  const cadence = { frames: submitted.length, duration_ms: submitted.at(-1).t - submitted[0].t,
    rate: (submitted.length - 1) * 1000 / (submitted.at(-1).t - submitted[0].t),
    interval_median_ms: intervals[Math.floor(intervals.length * .5)],
    interval_p95_ms: intervals[Math.floor(intervals.length * .95)], interval_max_ms: intervals.at(-1),
    boundary: "Vision frame-submitted, excluding load and idle; not physical scanout" };
  await page.evaluate(() => window.playMotion());
  await front.screenshot({ path: output("replay-after.png") });
  const replay = await solar.evaluate(() => globalThis.__motionRequests);
  const report = { command, baseline, after, cadence, capture:catalogue.capture ?? {codec:"vp9",fingerprint_interval_ms:0}, replay, errors, consoleMessages, native: await (await fetch(`${origin}/status`)).json() };
  await writeFile(output("capture.json"), JSON.stringify(report, null, 2));
  if (errors.length || consoleMessages.length) throw Error("Solar reported a runtime error");
  if (new Set(after.frames.map(f => f.hash)).size < (catalogue.capture?.minimum_distinct_frames ?? 40)) throw Error("Insufficient distinct rendered frames");
  if (catalogue.minimum_render_rate && cadence.rate < catalogue.minimum_render_rate) throw Error("Rendered cadence below fixture quality gate");
  if (replay.filter(r => r.type === "load").length !== baseline.filter(r => r.type === "load").length) throw Error("Animation reloaded the scene");
  console.log(JSON.stringify({ out, width: after.width, height: after.height, cadence, frames: after.frames.length, uniqueFrames: new Set(after.frames.map(f=>f.hash)).size, requestCounts: after.requests.reduce((r,v)=>(r[v.type]=(r[v.type]??0)+1,r),{}), errors, consoleMessages }));
} catch (error) {
  await page.screenshot({ path: output("failure.png") });
  const status=await(await fetch(`${origin}/status`)).text();
  console.log(JSON.stringify({errors,consoleMessages,status}));
  throw error;
} finally { await browser.close(); }
