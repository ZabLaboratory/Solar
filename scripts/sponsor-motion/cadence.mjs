/* global document, window */
import { createRequire } from "node:module";
import { writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require=createRequire(resolve(process.env.SPONSOR_PLAYWRIGHT_ROOT ?? process.cwd(),"package.json"));
const {chromium}=require("playwright");
const port=Number(process.env.SPONSOR_MOTION_PORT ?? 4580), origin=`http://127.0.0.1:${port}`;
const browser=await chromium.launch({channel:"chrome",headless:true,args:["--disable-background-timer-throttling","--disable-renderer-backgrounding"]});
const page=await browser.newPage({viewport:{width:1360,height:980}}), errors=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("console",e=>{if(e.type()==="error")errors.push(e.text());});
await page.route("**/vision/ui/mainpresenter.mjs",async route=>{
  const response=await route.fetch();
  const body=(await response.text()).replace("function emit(message) {","function emit(message) { if(message.type==='frame-submitted'){globalThis.__cadence ??= [];globalThis.__cadence.push({t:performance.now(),timing:message.timing});}");
  await route.fulfill({response,body});
});
try {
  await page.goto(origin);
  await page.waitForFunction(()=>!document.querySelector("#play").disabled,null,{timeout:45000});
  const frame=page.frames().find(f=>f.url().startsWith(`http://127.0.0.1:${port+1}/host.html`));
  await fetch(origin+"/play",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"cancel"})});
  await page.waitForTimeout(250);
  await frame.evaluate(()=>globalThis.__cadence=[]);
  await page.evaluate(()=>window.playMotion());
  const submissions=await frame.evaluate(()=>globalThis.__cadence);
  const intervals=submissions.slice(1).map((s,i)=>s.t-submissions[i].t).sort((a,b)=>a-b);
  const elapsed=submissions.at(-1).t-submissions[0].t;
  const report={origin,boundary:"Vision frame-submitted; no per-frame readback, screenshot or video encoder; not physical scanout",frames:submissions.length,
    duration_ms:elapsed,rate:(submissions.length-1)*1000/elapsed,p95_ms:intervals[Math.floor(intervals.length*.95)],max_ms:intervals.at(-1),errors,submissions};
  await writeFile(resolve(process.argv[2]),JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,submissions:undefined}));
  if(errors.length)throw Error("Cadence runtime errors");
} finally {await browser.close();}
