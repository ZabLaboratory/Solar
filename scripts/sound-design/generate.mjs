import {readFile,writeFile,mkdir} from "node:fs/promises";
import {resolve} from "node:path";
import {createHash} from "node:crypto";
import {canonicalize} from "@lumencast/canonical";
import {zipSync,strToU8} from "fflate";
const root=resolve(import.meta.dirname,"../.."),out=resolve(process.argv[2]);
const document=JSON.parse(await readFile(resolve(root,"fixtures/kumiki-motion/sponsor-motion.lsml"),"utf8"));
const assets={},declarations={};
for(const id of ["music","sweep","tick","spark","lock","orbit","room"]){
  const path=`assets/${id}.wav`,bytes=new Uint8Array(await readFile(resolve(out,path)));assets[path]=bytes;
  declarations[id]={src:path,sha256:createHash("sha256").update(bytes).digest("hex")};
}
const cue=(id,asset,start,duration,bus="fx",extra={})=>({id,asset,delay_ms:start,duration_ms:duration,bus,...extra});
const parallel=[cue("score","music",0,15000,"music",{gain_db:-1,fade_in_ms:1400,fade_out_ms:2000}),
  cue("orbital-bed","orbit",4600,5100,"space",{gain_db:-4,loop:true,fade_in_ms:500,fade_out_ms:900,
    automation:{pan:[{at_ms:0,value:-.65},{at_ms:1300,value:.8},{at_ms:3100,value:-.8},{at_ms:5100,value:.2}]}})];
for(let i=0;i<3;i++){
  parallel.push(cue(`reveal-${i}`,"spark",220+i*420,800,"space",{gain_db:-12,pan:(i-1)*.5,rate:1+i*.12}));
  parallel.push(cue(`unweave-${i}`,"sweep",2920+i*160,1100,"fx",{pan:(i-1)*.7,rate:1+i*.09,
    automation:{pan:[{at_ms:0,value:(i-1)*.7},{at_ms:1100,value:(1-i)*.7}]}}));
  parallel.push(cue(`crossing-${i}`,"sweep",5150+i*1160,1200,"space",{gain_db:-4,rate:.85+i*.12}));
  parallel.push(cue(`assembly-${i}`,"spark",11090+i*160,1000,"fx",{rate:.85+i*.08,gain_db:-3,pan:(i-1)*.45}));
  parallel.push(cue(`echo-${i}`,"spark",11800+i*190,900,"space",{gain_db:-9-i*3,rate:1.2+i*.15}));
}
parallel.push({delay_ms:3080,stagger_ms:31,parallel:Array.from({length:36},(_,i)=>({id:`contact-${i}`,asset:"tick",duration_ms:160,bus:"contacts",gain_db:-9,
  pan:Math.sin(i*Math.PI/18)*.75,rate:.85+(i%6)*.065}))});
parallel.push(cue("anticipation","sweep",9050,1250,"fx",{gain_db:-5,rate:.72}));
parallel.push(cue("assembly-lock","lock",11550,2000,"fx",{gain_db:-2,fade_out_ms:650}));
document["x-solar.audio"]={version:1,assets:declarations,buses:{
  master:{gain_db:-3,effects:[{type:"compressor",threshold:-10,knee:10,ratio:6,attack:.004,release:.16}]},
  music:{gain_db:-5,effects:[{type:"filter",kind:"lowpass",frequency:6000,q:.6}],automation:{
    gain_db:[{at_ms:0,value:-5},{at_ms:2800,value:-5},{at_ms:3100,value:-10},{at_ms:4300,value:-5},{at_ms:11000,value:-5},{at_ms:11450,value:-12},{at_ms:12500,value:-5},{at_ms:15000,value:-10}],
    frequency:[{at_ms:0,value:1400},{at_ms:4200,value:5200},{at_ms:9500,value:6200},{at_ms:15000,value:2100}]}},
  fx:{gain_db:-2,effects:[{type:"filter",kind:"highpass",frequency:40,q:.7},{type:"distortion",drive:1.1,wet:.12},{type:"compressor",threshold:-12,ratio:3,knee:8,attack:.005,release:.12}]},
  contacts:{gain_db:-2,effects:[{type:"delay",time_ms:123,feedback:.16,wet:.17},{type:"reverb",impulse:"room",wet:.12}]},
  space:{gain_db:-3,effects:[{type:"filter",kind:"highpass",frequency:150,q:.7},{type:"delay",time_ms:230,feedback:.22,wet:.22},{type:"reverb",impulse:"room",wet:.2}],
    automation:{wet:[{at_ms:0,value:.12},{at_ms:4500,value:.25},{at_ms:10500,value:.18},{at_ms:15000,value:.08}]}}
},shows:{show:{timeline:{parallel}}}};
document.scene_id="kumiki-sound-design";document.scene_version=`sha256:${"0".repeat(64)}`;
document.scene_version=`sha256:${createHash("sha256").update(canonicalize(document)).digest("hex")}`;
const json=canonicalize(document);await mkdir(out,{recursive:true});
await writeFile(resolve(out,"sponsor-motion.lsml"),json);
await writeFile(resolve(out,"sponsor-motion.lsmlz"),zipSync({"scene.lsml":strToU8(json),...assets}));
await writeFile(resolve(out,"catalogue.json"),JSON.stringify({width:1280,height:720,duration_ms:15000,title:"Kumiki · Motion & Sound",slug:"kumiki-sound",
  description:"Musique originale, souffles stéréo, cascade de contacts et verrouillage résonant. Cinq bus, effets et automation dans le LSML.",animations:["show"],minimum_render_rate:45,
  capture:{codec:"vp8",fingerprint_interval_ms:100,minimum_distinct_frames:60}},null,2));
console.log(JSON.stringify({out,scene_version:document.scene_version,assets:7,buses:5,cues:parallel.length+35}));
