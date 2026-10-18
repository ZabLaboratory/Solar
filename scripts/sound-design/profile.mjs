/* global document, window, AudioContext, AudioParam */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require = createRequire(
  resolve(process.env.SPONSOR_PLAYWRIGHT_ROOT ?? process.cwd(), "package.json"),
);
const { chromium } = require("playwright");
const origin = `http://127.0.0.1:${process.env.SPONSOR_MOTION_PORT ?? 4610}`;
const out = resolve(process.argv[2]);
await mkdir(out, { recursive: true });
const stamp = new Date()
  .toISOString()
  .replace(/[-:]/g, "")
  .replace(/\.\d+Z$/, "Z");
const modes = (process.env.SOUND_PROFILE_MODES ?? "off,on,no-heavy-dsp").split(
  ",",
);
const browser = await chromium.launch({
  channel: "chrome",
  headless: true,
  args: [
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
  ],
});
const reports = [];
try {
  for (const mode of modes) {
    await fetch(origin + "/play", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ action: "cancel" }),
    });
    const page = await browser.newPage({
        viewport: { width: 1360, height: 980 },
      }),
      errors = [];
    page.on("pageerror", (e) => errors.push(e.message));
    page.on("console", (e) => {
      if (e.type() === "error") errors.push(e.text());
    });
    await page.addInitScript((mode) => {
      globalThis.__soundPerf = { long: [], audioCalls: {} };
      new PerformanceObserver((list) =>
        globalThis.__soundPerf.long.push(
          ...list
            .getEntries()
            .map((e) => ({ start: e.startTime, duration: e.duration })),
        ),
      ).observe({ type: "longtask", buffered: true });
      for (const key of [
        "setTargetAtTime",
        "linearRampToValueAtTime",
        "setValueAtTime",
      ]) {
        const original = AudioParam.prototype[key];
        AudioParam.prototype[key] = function (...args) {
          const c = globalThis.__soundPerf.audioCalls;
          c[key] = (c[key] ?? 0) + 1;
          return original.apply(this, args);
        };
      }
      if (mode === "no-heavy-dsp")
        for (const key of ["createConvolver", "createWaveShaper"])
          AudioContext.prototype[key] = function () {
            return this.createGain();
          };
    }, mode);
    await page.route("**/assets/host-*.js", async (route) => {
      const response = await route.fetch();
      let body = await response.text();
      if (mode === "off") {
        const next = body.replace(
          /sceneAudio:[^,]+,onError:/,
          "sceneAudio:false,onError:",
        );
        if (next === body)
          throw Error("Audio-off probe could not identify mount option");
        body = next;
      }
      await route.fulfill({ response, body });
    });
    await page.route("**/vision/ui/mainpresenter.mjs", async (route) => {
      const response = await route.fetch();
      const body = (await response.text()).replace(
        "function emit(message) {",
        "function emit(message) { if(message.type==='frame-submitted'){globalThis.__soundCadence ??= [];globalThis.__soundCadence.push({t:performance.now(),timing:message.timing});}",
      );
      await route.fulfill({ response, body });
    });
    await page.goto(origin);
    await page.waitForFunction(
      () => !document.querySelector("#play").disabled,
      null,
      { timeout: 45000 },
    );
    const frame = page.frames().find((f) => f.url().includes("/host.html"));
    await page.waitForTimeout(250);
    await frame.evaluate(() => {
      globalThis.__soundCadence = [];
      globalThis.__soundPerf.long = [];
      globalThis.__soundPerf.audioCalls = {};
    });
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Profiler.enable");
    await cdp.send("Profiler.setSamplingInterval", { interval: 2000 });
    await cdp.send("Profiler.start");
    await page.click("#play");
    await page.waitForFunction(() => Boolean(window.lastCommand));
    const queuedAtStart = await frame.evaluate(
      () => globalThis.__SOLAR_AUDIO__.status().scheduled,
    );
    await page.waitForTimeout(15200);
    const { profile } = await cdp.send("Profiler.stop");
    const data = await frame.evaluate(() => ({
      submissions: globalThis.__soundCadence,
      perf: globalThis.__soundPerf,
      sound: globalThis.__SOLAR_AUDIO__.status(),
    }));
    const entries = data.submissions,
      elapsed = entries.at(-1).t - entries[0].t,
      intervals = entries
        .slice(1)
        .map((e, i) => e.t - entries[i].t)
        .sort((a, b) => a - b);
    const nodes = new Map(profile.nodes.map((n) => [n.id, n.callFrame]));
    const hot = new Map();
    for (let i = 0; i < profile.samples.length; i++) {
      const f = nodes.get(profile.samples[i]),
        key =
          f.functionName + " " + f.url.split("/").at(-1) + ":" + f.lineNumber;
      hot.set(key, (hot.get(key) ?? 0) + profile.timeDeltas[i]);
    }
    const report = {
      mode,
      queuedAtStart,
      rate: ((entries.length - 1) * 1000) / elapsed,
      p95: intervals[Math.floor(intervals.length * 0.95)],
      max: intervals.at(-1),
      frames: entries.length,
      perf: data.perf,
      sound: data.sound,
      errors,
      hot: [...hot].sort((a, b) => b[1] - a[1]).slice(0, 20),
      boundary:
        "Native Vision frame submissions; no video encoder; audio mode probe only in owned browser",
    };
    await writeFile(
      resolve(out, `${stamp}-${mode}-profile.json`),
      JSON.stringify(profile),
    );
    await writeFile(
      resolve(out, `${stamp}-${mode}-cadence.json`),
      JSON.stringify(data),
    );
    reports.push(report);
    console.log(JSON.stringify(report));
    await page.close();
  }
  await writeFile(
    resolve(out, `${stamp}-performance.json`),
    JSON.stringify(reports, null, 2),
  );
} finally {
  await browser.close();
}
