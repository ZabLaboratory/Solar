// Three authored acts, nested parallel tracks, retained effects and cubic travel.
export function composedScene(size) {
  const track = (target, duration_ms, steps, extra = {}) => ({ target, keyframes:{ duration_ms, steps }, ...extra });
  const spring = { type:"spring", stiffness:115, damping:15, mass:1 };
  const out = "hero-out", incoming = "hero-in";
  const children = [
    {kind:"image",id:out,position:{x:0,y:0},size:{w:size,h:size},src:"assets/w.png",fit:"fill",
      "x-vision.waveWavelength":600,"x-vision.waveHarmonic":.16,shadow:[{color:"#00000000",blur:0,x:0,y:0}]},
    {kind:"image",id:incoming,position:{x:0,y:0},size:{w:size,h:size},src:"assets/hello-fresh.png",fit:"fill",opacity:0,
      "x-vision.waveWavelength":620,"x-vision.waveHarmonic":.22,shadow:[{color:"#00000000",blur:0,x:0,y:0}]},
    ...Array.from({length:3},(_,i)=>({kind:"shape",id:`accent-${i}`,shape:"rect",position:{x:0,y:0},size:{w:38-i*6,h:38-i*6},cornerRadius:10,fill:"#ef1028",stroke:{color:"#ffffff",width:1},opacity:0})),
  ];
  const anticipation = {parallel:[
    track(out,900,[{at:0,scale:1,rotation:0,skewX:0,shadowBlur:0,shadowColor:"#00000000",easing:"ease-in-out"},{at:1,scale:.88,rotation:-6,skewX:4,shadowBlur:20,shadowColor:"#00000080"}]),
    {parallel:Array.from({length:3},(_,i)=>track(`accent-${i}`,650,[{at:0,opacity:0,scale:.4,rotation:0,fill:"#ef1028",easing:"ease-out"},{at:.3,opacity:.9,scale:1.3},{at:1,opacity:0,scale:.8,rotation:120,fill:"#009251"}],{motion_path:{points:[[80+i*80,580],[60,220],[550,40],[630,310]],orient:false}})),stagger_ms:100},
  ]};
  const travel = {parallel:[
    track("stage",2700,[{at:0,background:"#000000",easing:"ease-in-out"},{at:1,background:"#087f49"}]),
    track(out,2700,[{at:0,scale:.88,rotation:-6,skewX:4,waveAmplitude:0,wavePhase:0,easing:"ease-in-out"},{at:.35,scale:.82,rotation:-14,skewX:-3,waveAmplitude:35,wavePhase:-4},{at:1,scale:.7,rotation:-12,skewX:0,waveAmplitude:0,wavePhase:-9}],{motion_path:{points:[[0,0],[-80,-90],[-620,180],[-860,-60]],easing:"ease-in-out"}}),
    track(incoming,2700,[{at:0,opacity:1,scale:.78,rotation:12,skewX:-6,blur:3,waveAmplitude:0,wavePhase:0,shadowBlur:24,shadowColor:"#00000090",easing:"ease-in-out"},{at:.45,scale:.87,rotation:4,skewX:3,blur:1,waveAmplitude:28,wavePhase:-5},{at:1,scale:1.03,rotation:-1,skewX:0,blur:0,waveAmplitude:0,wavePhase:-11,shadowBlur:8,shadowColor:"#00000050"}],{motion_path:{points:[[size+90,90],[460,-140],[-130,160],[0,0]],easing:"ease-in-out"}}),
  ]};
  const settle = {parallel:[
    track(incoming,1400,[{at:0,scale:1.03,rotation:-1,shadowBlur:8,shadowColor:"#00000050",easing:spring},{at:.7,scale:1,rotation:0,shadowBlur:0,shadowColor:"#00000000"},{at:1,scale:1,rotation:0,shadowBlur:0,shadowColor:"#00000000"}]),
    {parallel:Array.from({length:3},(_,i)=>track(`accent-${i}`,1000,[{at:0,opacity:0,scale:.5,rotation:0,fill:"#ffffff",strokeWidth:2,easing:"ease-out"},{at:.2,opacity:.85,scale:1},{at:1,opacity:0,scale:.15,rotation:180,fill:"#91efbe",strokeWidth:0}],{motion_path:{points:[[size/2,360],[110+i*120,120],[600-i*50,480],[80+i*230,680]],orient:false}})),stagger_ms:100},
  ]};
  return { children, animations:{show:{sequence:[anticipation,travel,settle]}}, duration:5000,
    title:"Sponsor Motion Studio",slug:"sponsor-composed",minimumRenderRate:45,
    description:"3 actes · compositions parallèles imbriquées · Bézier · ressort · zoom GPU · inclinaison · ombres · couleurs · onde continue." };
}
