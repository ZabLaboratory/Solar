/* global document */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
const require=createRequire(resolve(process.env.SPONSOR_PLAYWRIGHT_ROOT ?? process.cwd(),"package.json"));
const { chromium }=require("playwright");
const port=Number(process.env.SPONSOR_MOTION_PORT ?? 4580), origin=`http://127.0.0.1:${port}`;
const output=resolve(process.argv[2]);
await mkdir(output,{recursive:true});
const stamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d+Z$/,"Z");
const browser=await chromium.launch({channel:"chrome",headless:true});
const page=await browser.newPage({viewport:{width:1360,height:980}});
const errors=[], failed=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("console",e=>{if(e.type()==="error")errors.push(e.text());});
page.on("requestfailed",r=>failed.push(r.url()));
try {
  await page.goto(origin);
  await page.waitForFunction(()=>!document.querySelector("#play").disabled,null,{timeout:45000});
  const frame=page.frames().find(f=>f.url().startsWith(`http://127.0.0.1:${port+1}/host.html`));
  const canvas=frame.locator("#scene canvas[aria-hidden=true]").last();
  const command=async body=>{
    const response=await fetch(origin+"/play",{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify(body)});
    if(!response.ok)throw Error(await response.text());
    await page.waitForTimeout(200);
  };
  await command({action:"pause"});
  const times=[0,700,1400,2200,2700,3080,3500,3890,4400,4780,5300,6000,7000];
  for(const time_ms of times) {
    await command({action:"seek",time_ms});
    await canvas.screenshot({path:resolve(output,`${stamp}-vector-${String(time_ms).padStart(4,"0")}.png`)});
  }
  await command({action:"cancel"});
  await writeFile(resolve(output,`${stamp}-storyboard.json`),JSON.stringify({times,errors,failed,origin},null,2));
  if(errors.length || failed.length)throw Error("Storyboard reader errors");
  console.log(JSON.stringify({stamp,output,times,errors,failed}));
} finally {await browser.close();}
