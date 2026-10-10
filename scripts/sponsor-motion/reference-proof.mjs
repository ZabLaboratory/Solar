/* global document */
import { createRequire } from "node:module";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require=createRequire(resolve(process.env.SPONSOR_PLAYWRIGHT_ROOT ?? process.cwd(),"package.json"));
const { chromium }=require("playwright");
const fixture=JSON.parse(await readFile(resolve("fixtures/sponsor-motion/openai-reference/motion-vectors.json"),"utf8"));
const output=resolve(process.argv[2]);
await mkdir(output,{recursive:true});
const port=Number(process.env.SPONSOR_MOTION_PORT ?? 4590), origin=`http://127.0.0.1:${port}`;
const browser=await chromium.launch({channel:"chrome",headless:true});
const page=await browser.newPage({viewport:{width:1360,height:1050}}), errors=[];
await page.addInitScript(()=>document.addEventListener("solar:lsdp-applied",e=>{
  globalThis.__referenceReceipts ??= [];
  globalThis.__referenceReceipts.push(e.detail);
},true));
page.on("pageerror",e=>errors.push(e.message));
page.on("console",e=>{if(e.type()==="error")errors.push(e.text());});
try {
  await page.goto(origin);
  await page.waitForFunction(()=>!document.querySelector("#play").disabled,null,{timeout:60000});
  const frame=page.frames().find(f=>f.url().startsWith(`http://127.0.0.1:${port+1}/host.html`));
  const canvas=frame.locator("#scene canvas[aria-hidden=true]").last();
  const command=async body=>{
    const r=await fetch(origin+"/play",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    if(!r.ok)throw Error(await r.text());
    const result=await r.json(), id=result.receipt.receipt.transactionId;
    await frame.waitForFunction(id=>globalThis.__referenceReceipts?.some(r=>r.transactionId===id),id,{timeout:10000});
  };
  await command({action:"pause"});
  await page.waitForTimeout(1800);
  const positions=[];
  for(let index=0;index<fixture.reference.frames;index++) {
    const time_ms=index*1000/fixture.reference.fps;
    await command({action:"seek",time_ms});
    await canvas.screenshot({path:resolve(output,`frame-${String(index).padStart(3,"0")}.png`)});
    positions.push({index,time_ms});
    if(index%30===0)console.log(JSON.stringify({captured:index,total:fixture.reference.frames}));
  }
  const midpoints=[];
  for(const index of [91,94,96,98,100,102,105,110,138,145,152,158,166,175]) {
    const time_ms=(index+.5)*1000/fixture.reference.fps;
    await command({action:"seek",time_ms});
    await canvas.screenshot({path:resolve(output,`midpoint-${index}.png`)});
    midpoints.push({index,time_ms});
  }
  await command({action:"cancel"});
  await writeFile(resolve(output,"captures.json"),JSON.stringify({origin,positions,midpoints,errors,reference:fixture.reference},null,2));
  if(errors.length)throw Error("Reference reader errors");
  console.log(JSON.stringify({output,frames:positions.length,errors}));
} finally {await browser.close();}
