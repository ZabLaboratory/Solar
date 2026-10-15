/* global document, window, MediaRecorder, MediaStream */
import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createHash } from "node:crypto";
const require=createRequire(resolve(process.env.SPONSOR_PLAYWRIGHT_ROOT ?? process.cwd(),"package.json"));
const {chromium}=require("playwright");
const root=resolve(import.meta.dirname,"../..");
const out=resolve(root,process.argv[2] ?? "evidence/local-20261010-sound-design/eleven");
const port=Number(process.env.SPONSOR_MOTION_PORT ?? 4610), origin=`http://127.0.0.1:${port}`;
const stamp=new Date().toISOString().replace(/[-:]/g,"").replace(/\.\d+Z$/,"Z");
const path=name=>resolve(out,`${stamp}-${name}`);
await mkdir(out,{recursive:true});
await fetch(`${origin}/play`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify({action:"cancel"})});
const browser=await chromium.launch({channel:"chrome",headless:true,args:["--disable-background-timer-throttling","--disable-renderer-backgrounding"]});
const page=await browser.newPage({viewport:{width:1360,height:1000}}), errors=[];
page.on("pageerror",e=>errors.push(e.message));
page.on("console",e=>{if(e.type()==="error")errors.push(e.text());});
await page.route("**/vision/ui/mainpresenter.mjs",async route=>{
  const response=await route.fetch(), body=(await response.text()).replace("function postMessage(request) {","function postMessage(request) { globalThis.__soundRequests ??= []; globalThis.__soundRequests.push(request.type);");
  await route.fulfill({response,body});
});
try {
  await page.goto(origin);
  await page.waitForFunction(()=>!document.querySelector("#play").disabled,null,{timeout:45000});
  const frame=page.frames().find(f=>f.url().startsWith(`http://127.0.0.1:${port+1}/host.html`));
  if(!frame)throw Error("Native Solar host absent");
  const status=()=>frame.evaluate(()=>globalThis.__SOLAR_AUDIO__.status());
  const before=await status();
  if(before.assets!==7)throw Error("Seven exact audio assets not admitted");
  const offline=await frame.evaluate(async()=>{
    const buffer=await globalThis.__SOLAR_AUDIO__.render("show");
    const bytes=new Uint8Array(44+buffer.length*4),view=new DataView(bytes.buffer);
    const ascii=(at,s)=>{for(let i=0;i<s.length;i++)bytes[at+i]=s.charCodeAt(i);};
    ascii(0,"RIFF");view.setUint32(4,bytes.length-8,true);ascii(8,"WAVE");ascii(12,"fmt ");view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,2,true);view.setUint32(24,buffer.sampleRate,true);view.setUint32(28,buffer.sampleRate*4,true);view.setUint16(32,4,true);view.setUint16(34,16,true);ascii(36,"data");view.setUint32(40,buffer.length*4,true);
    let energy=0,peak=0,finite=true;const windows=[];
    for(let i=0;i<buffer.length;i++) for(let c=0;c<2;c++) {const v=buffer.getChannelData(c)[i];finite&&=Number.isFinite(v);energy+=v*v;peak=Math.max(peak,Math.abs(v));view.setInt16(44+(i*2+c)*2,Math.round(Math.max(-1,Math.min(1,v))*32767),true);}
    for(let s=0;s<15;s++){let sum=0;for(let i=s*48000;i<(s+1)*48000;i++)for(let c=0;c<2;c++)sum+=buffer.getChannelData(c)[i]**2;windows.push(Math.sqrt(sum/96000));}
    let text="";for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));
    return {wav:btoa(text),frames:buffer.length,sampleRate:buffer.sampleRate,rms:Math.sqrt(energy/(buffer.length*2)),peak,finite,seconds:buffer.duration,windows};
  });
  const wav=Buffer.from(offline.wav,"base64");delete offline.wav;
  await writeFile(path("kumiki-score.wav"),wav);
  offline.sha256=createHash("sha256").update(wav).digest("hex");
  if(!offline.finite||offline.rms<.005||offline.peak>1)throw Error("Offline PCM gate failed");
  await frame.evaluate(()=>{
    const canvas=[...document.querySelectorAll("#scene canvas[aria-hidden=true]")].at(-1);
    const audio=globalThis.__SOLAR_AUDIO__.stream();
    const stream=new MediaStream([...canvas.captureStream(60).getVideoTracks(),...audio.getAudioTracks()]);
    const recorder=new MediaRecorder(stream,{mimeType:"video/webm;codecs=vp9,opus",videoBitsPerSecond:10000000,audioBitsPerSecond:192000});
    const chunks=[];recorder.ondataavailable=e=>chunks.push(e.data);
    globalThis.__soundStop=()=>new Promise(resolve=>{recorder.onstop=async()=>{const bytes=new Uint8Array(await new Blob(chunks).arrayBuffer());let text="";for(let i=0;i<bytes.length;i+=32768)text+=String.fromCharCode(...bytes.subarray(i,i+32768));resolve(btoa(text));};recorder.stop();});
    recorder.start();
  });
  // Real click with normal browser autoplay policy, no permissive command-line override.
  await page.click("#play");
  await page.waitForFunction(()=>Boolean(window.lastCommand));
  const live=[];for(let i=0;i<30;i++){await page.waitForTimeout(500);live.push(await status());}
  await page.waitForTimeout(1500);
  const video=await frame.evaluate(()=>globalThis.__soundStop());
  await writeFile(path("kumiki-sound.webm"),Buffer.from(video,"base64"));
  await frame.locator("#scene canvas[aria-hidden=true]").last().screenshot({path:path("settled.png")});
  if(!live.some(s=>s.rms>.01)||live.some(s=>s.state==="blocked"))throw Error("Gesture did not unlock actual live signal");
  const command=c=>page.evaluate(c=>window.controlMotion(c),c);
  const controls=[];
  await command({action:"play"});await page.waitForTimeout(1500);
  await command({action:"pause"});await page.waitForTimeout(250);controls.push({action:"pause",...await status()});
  await command({action:"seek",time_ms:6300});await page.waitForTimeout(150);controls.push({action:"seek-paused",...await status()});
  await command({action:"resume"});await page.waitForTimeout(400);controls.push({action:"resume",...await status()});
  await command({action:"speed",speed:2});await page.waitForTimeout(300);controls.push({action:"speed",...await status()});
  await command({action:"reverse"});await page.waitForTimeout(300);controls.push({action:"reverse",...await status()});
  const mix=async value=>{const r=await fetch(`http://127.0.0.1:${port+1}/mutations`,{method:"POST",headers:{"content-type":"application/json"},body:JSON.stringify([{op:"add",path:"/defaults/__audio.mix",value}])});if(!r.ok)throw Error(await r.text());};
  await mix({master:{mute:true}});await page.waitForTimeout(400);controls.push({action:"mute",...await status()});
  await mix({music:{gain_db:-18,frequency:700},space:{wet:.05,pan:-.5}});await page.waitForTimeout(400);controls.push({action:"effect-mix",...await status()});
  await command({action:"stop"});await page.waitForTimeout(200);controls.push({action:"stop",...await status()});
  await mix({});
  const requests=await frame.evaluate(()=>globalThis.__soundRequests ?? []);
  const report={before,offline,live,controls,errors,loads:requests.filter(t=>t==="load").length,policy:"normal browser autoplay policy; actual user click",boundary:"Actual native Vision canvas + live scene-audio MediaStream; offline PCM is separately exported; no Pulsar/Program qualification"};
  await writeFile(path("proof.json"),JSON.stringify(report,null,2));
  if(errors.length)throw Error("Runtime errors: "+errors.join("; "));
  if(controls.filter(c=>["pause","seek-paused","mute","stop"].includes(c.action)).some(c=>c.rms>.0001))throw Error("Paused/muted sound was not silent");
  if(!controls.find(c=>c.action==="resume").rms)throw Error("Resume did not produce PCM");
  if(controls.find(c=>c.action==="reverse").transports[0].speed!==-2)throw Error("Reverse transport diverged");
  if(report.loads!==1)throw Error("Audio controls reloaded Vision scene");
  console.log(JSON.stringify({out,stamp,offline,livePeak:Math.max(...live.map(s=>s.peak)),scheduled:Math.max(...live.map(s=>s.scheduled)),controls:controls.map(c=>({action:c.action,rms:c.rms,state:c.state})),loads:report.loads}));
}catch(error){await page.screenshot({path:path("failure.png")});console.error(JSON.stringify({errors}));throw error;}finally{await browser.close();}
