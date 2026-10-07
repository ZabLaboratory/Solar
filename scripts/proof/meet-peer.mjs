// Real Meet signaling + shared publisher; no writes in the Meet repository.
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import { createWriteStream } from "node:fs";
import { resolve } from "node:path";
import { createServer } from "node:net";
import { build } from "esbuild";

export const rtcMetrics = `
const NativeRTC=globalThis.RTCPeerConnection;let serial=0;
globalThis.RTCPeerConnection=class extends NativeRTC {
 constructor(...args){super(...args);const id=++serial;const timer=setInterval(async()=>{
 if(this.connectionState==='closed'){clearInterval(timer);return}
 try {const stats=await this.getStats();const media=[];
 stats.forEach(s=>{if((s.type==='inbound-rtp'||s.type==='outbound-rtp')&&(s.kind==='video'||s.mediaType==='video'))
 media.push({type:s.type,framesDecoded:s.framesDecoded??0,framesSent:s.framesSent??0,bytesReceived:s.bytesReceived??0,bytesSent:s.bytesSent??0})});
 report({type:'rtc',id,state:this.connectionState,media});}catch{}
 },1000);}
};`;

export async function startMeetProof({ root, port, origin, output, camera }) {
  const reservation = createServer();
  await new Promise(yes => reservation.listen(0, "127.0.0.1", yes));
  port = reservation.address().port;
  await new Promise(yes => reservation.close(yes));
  const admin = randomBytes(32).toString("hex"), url = `http://127.0.0.1:${port}`;
  const log = createWriteStream(output + "-meet.log");
  const child = spawn(process.execPath, ["--import", "tsx", "src/server.ts"], {
    cwd: root, windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, PORT: String(port), ALLOWED_ORIGINS: origin, ADMIN_TOKEN: admin,
      TURN_SECRET: randomBytes(32).toString("hex"), TURN_URLS: "stun:127.0.0.1:9" },
  });
  child.stdout.pipe(log); child.stderr.pipe(log);
  const stop = async () => {
    if (child.exitCode === null) { const exited = new Promise(yes => child.once("exit", yes)); child.kill(); await exited; }
  };
  try {
    let ready = false;
    for (let i = 0; i < 80; i++) {
      if (child.exitCode !== null) throw new Error("Meet exited before readiness");
      try { const response = await fetch(url + "/healthz"); ready = response.ok; await response.body?.cancel(); } catch { /* boot */ }
      if (ready) break; await new Promise(yes => setTimeout(yes, 100));
    }
    if (!ready) throw new Error("Meet readiness timeout");
    const response = await fetch(url + "/rooms", { method: "POST", headers: {
      Authorization: `Bearer ${admin}`, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "Solar local qualification", max_peers: 4, persistent: true }) });
    if (response.status !== 201) throw new Error("Meet room creation failed: " + response.status);
    const room = await response.json();
    const client = await build({ entryPoints: [resolve(root, "src/client/index.ts")], bundle: true,
      write: false, format: "esm", platform: "browser" });
    const options = { signalingUrl: url.replace("http:", "ws:") + "/ws", roomId: room.id, token: room.token, name: "proof_peer" };
    const page = `<!doctype html><html><body style="margin:0;background:black"><video autoplay muted playsinline style="width:100vw;height:100vh;object-fit:cover"></video>
      <script type="module">${client.outputFiles[0].text.replace(/\bexport\s*\{[^}]*\};?\s*$/, "")}
      const report=detail=>fetch('/__render_diag',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({lane:'publisher',...detail})}).catch(()=>{});
      ${rtcMetrics}
      let publisher=null,busy=false;
      async function poll(){if(busy)return;busy=true;try{
        const desired=await fetch('/peer/publisher-state').then(r=>r.json());
        if(!desired.active&&publisher){publisher.leave();publisher=null;document.querySelector('video').srcObject=null;report({type:'publisher-left'})}
        if(desired.active&&!publisher){
          const devices=await navigator.mediaDevices.enumerateDevices();
          const camera=devices.find(d=>d.kind==='videoinput'&&d.label===${JSON.stringify(camera)});
          if(!camera)throw Error('Physical camera missing');
          const next=new MeetClient({...${JSON.stringify(options)},media:{audio:false,video:{deviceId:{exact:camera.deviceId},width:{ideal:640},height:{ideal:360}}}});
          const stream=await next.joinAsPublisher();publisher=next;document.querySelector('video').srcObject=stream;
          report({type:'publisher-joined',tracks:stream.getVideoTracks().map(t=>({label:t.label,width:t.getSettings().width,height:t.getSettings().height}))});
        }
      }catch(error){report({type:'error',message:error.message})}finally{busy=false}}
      setInterval(poll,500);poll();
      </script></body></html>`;
    return { pid: child.pid, page, stop,
      viewer: { rooms: [{ signalingUrl: options.signalingUrl, roomId: room.id, token: room.viewer_token }] },
      health: async () => (await fetch(url + "/healthz")).json(),
    };
  } catch (error) { await stop(); throw error; }
}
