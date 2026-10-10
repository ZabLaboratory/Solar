// Reconstruction authored from the reference recording. SVG contours are actual
// shape geometry, never a video/image sequence. All playback lives in LSML tracks.
export function openaiScene(vectors) {
  const width = 1280, height = 720, duration = 7000;
  const children = [], tracks = [];
  const point = (ms, values, easing = "cubic-bezier(0.55,0,0.25,1)") => ({at:ms/duration,...values,easing});
  const track = (target, steps) => tracks.push({target,keyframes:{duration_ms:duration,steps}});
  const curvePath = points => "M" + points[0].map(v=>v.toFixed(3)).join(" ") + " " +
    Array.from({length:(points.length-1)/3},(_,i)=>"C"+points.slice(1+i*3,4+i*3).flat().map(v=>v.toFixed(3)).join(" ")).join(" ");
  const rotate = (p,angle) => [p[0]*Math.cos(angle)-p[1]*Math.sin(angle),p[0]*Math.sin(angle)+p[1]*Math.cos(angle)];
  // Five cubic segments for every pose: correspondence is explicit per brin.
  const brin = [[-36,56],[-56,18],[-77,-20],[-97,-57],
    [-79,-90],[-61,-122],[-43,-155],
    [-7,-219],[109,-207],[125,-116],
    [86,-116],[45,-116],[6,-116],
    [-16,-77],[-38,-39],[-60,0]];
  const arc = [[-102,68],[-141,42],[-162,-2],[-158,-44],
    [-154,-86],[-133,-123],[-96,-143],
    [-69,-158],[-35,-162],[-3,-154],
    [14,-150],[29,-141],[42,-132],
    [46,-127],[50,-122],[54,-117]];
  const rows = [[560,286,260],[560,330,82],[560,422,260],[560,467,260],[560,512,260],[560,557,178]];
  for (let i=0;i<6;i++) {
    const id=`brin-${i}`, angle=i*Math.PI/3;
    const [x,y,len]=rows[i];
    const line=Array.from({length:16},(_,j)=>[x-640+len*j/15,y-360]);
    const round=arc.map(p=>rotate(p,angle));
    const final=brin.map(p=>rotate(p,angle));
    const tiny=line.map(p=>[line[0][0]+(p[0]-line[0][0])*.005,p[1]]);
    children.push({kind:"shape",id,geometry:"path",position:{x:410,y:135},size:{w:460,h:450},
      stroke:{color:"#fff",width:21,lineCap:"butt",lineJoin:"round"},"x-vision.trimEnd":0,opacity:0});
    // Paths are authored relative to (640,360); convert local origin once.
    const local = points => curvePath(points.map(p=>[p[0]+230,p[1]+225]));
    const paths=[tiny,line,round,final].map(local);
    children.at(-1).pathData=paths[0];
    const start=i<2?430+i*150:1120+(i-2)*145;
    track(id,[point(0,{pathData:paths[0],opacity:0,trimEnd:0,strokeWidth:21}),
      point(start-1,{pathData:paths[0],opacity:0,trimEnd:0}),
      point(start,{pathData:paths[0],opacity:1,trimEnd:1,strokeWidth:21}),
      point(start+300,{pathData:paths[1],strokeWidth:18}),
      point(2520+i*22,{pathData:paths[1],trimStart:0,trimEnd:1,strokeWidth:18}),
      point(3030+i*18,{pathData:paths[2],trimStart:.05,trimEnd:.85,strokeWidth:18}),
      point(3340+i*13,{pathData:paths[3],trimStart:.45,trimEnd:.88,strokeWidth:25}),
      point(3740,{pathData:paths[3],trimStart:0,trimEnd:1,strokeWidth:25,opacity:1}),
      point(3840,{opacity:0}),point(7000,{opacity:0})]);
  }
  const emblem = {kind:"shape",id:"emblem",geometry:"path",pathData:vectors.symbol.path,windingRule:"EVENODD",
    position:{x:410,y:135},size:{w:460,h:450},fill:"#fff",opacity:0};
  children.push(emblem);
  track("emblem",[point(0,{opacity:0,scale:1,rotation:0}),point(3740,{opacity:0,scale:1,rotation:0}),
    point(3840,{opacity:1,scale:1,rotation:0}),point(4110,{opacity:1,scale:1,translateX:0,translateY:0}),
    point(4340,{opacity:1}),point(4460,{opacity:0,scale:.46,translateX:-318,translateY:0,rotation:30}),point(7000,{opacity:0,scale:.46,translateX:-318,translateY:0,rotation:30})]);
  const finalSymbol=vectors.symbolFinal;
  children.push({kind:"shape",id:"final-emblem",geometry:"path",pathData:finalSymbol.path,windingRule:"EVENODD",
    position:{x:finalSymbol.x,y:finalSymbol.y},size:{w:finalSymbol.width,h:finalSymbol.height},fill:"#fff",opacity:0});
  track("final-emblem",[point(0,{opacity:0}),point(4340,{opacity:0}),point(4460,{opacity:1}),point(7000,{opacity:1})]);
  // Square -> bullet markers. Their fades follow the line growth and spiral handoff.
  for(let i=0;i<2;i++) {
    const id=`bullet-${i}`;
    children.push({kind:"shape",id,geometry:i?"circle":"rect",position:{x:523,y:i?410:277},size:{w:21,h:21},fill:"#fff",opacity:i?0:1,"x-vision.scaleX":.8,"x-vision.scaleY":.8});
    track(id,[point(0,{opacity:i?0:1,scale:.8}),point(i?1040:330,{opacity:1,scale:1}),
      point(2440,{opacity:1,scale:.75}),point(2900,{opacity:0,scale:.2,rotation:90}),point(7000,{opacity:0})]);
  }
  // Exact reconstructed glyph outlines, split into three independently animated
  // clipped bands. This models the reference's fragmented letter assembly.
  for(const [i,glyph] of vectors.glyphs.entries()) {
    for(let band=0;band<3;band++) {
      const id=`glyph-${i}-${band}`, h=54;
      children.push({kind:"frame",id,position:{x:glyph.x-4,y:glyph.y+band*h-5},size:{w:glyph.width,h},clipsContent:true,opacity:0,
        children:[{kind:"shape",id:`outline-${i}-${band}`,geometry:"path",pathData:glyph.path,windingRule:"EVENODD",
          position:{x:0,y:-band*h},size:{w:glyph.width,h:glyph.height},fill:"#fff"}]});
      const start=4570+i*85+band*43;
      const offsets=[[25,-24],[-22,31],[38,18]];
      track(id,[point(0,{opacity:0,scaleX:.06,translateX:offsets[band][0],translateY:offsets[band][1],rotation:(band-1)*14}),
        point(start,{opacity:0,scaleX:.06,translateX:offsets[band][0],translateY:offsets[band][1]}),
        point(start+90,{opacity:1,scaleX:.13}),point(start+510,{opacity:1,scaleX:1,translateX:0,translateY:0,rotation:0}),
        point(7000,{opacity:1,scaleX:1,translateX:0,translateY:0,rotation:0})]);
    }
  }
  for(let i=0;i<9;i++) {
    const id=`fragment-${i}`, x=450+i*67, y=280+(i%3)*80;
    children.push({kind:"shape",id,position:{x,y},size:{w:12,h:12},fill:"#fff",opacity:0});
    const start=4310+i*38;
    track(id,[point(0,{opacity:0}),point(start-1,{opacity:0,scale:.8,translateY:-80+(i%3)*32}),point(start,{opacity:1,scale:.8,translateY:-80+(i%3)*32}),
      point(start+340,{opacity:.8,scale:.55,translateY:20,rotation:i*30}),point(5480,{opacity:0,scale:.1}),point(7000,{opacity:0})]);
  }
  return {width,height,children,animations:{show:{parallel:tracks}},duration,
    title:"Vector Motion · OpenAI",slug:"openai-vector",minimumRenderRate:45,
    capture:{fingerprint_interval_ms:100,minimum_distinct_frames:20,codec:"vp8"},
    description:"Reconstruction de la vidéo · lignes → arcs → six brins → symbole → lettres fragmentées · tracés Bézier, morphing et révélation vectorielle."};
}

// Reference-specific rotoscope: measured contour motion, not a procedural logo rig.
export function referenceScene(vectors) {
  const tracks = [...vectors.tracks].sort((a,b)=>a.hole-b.hole);
  return {width:vectors.width,height:vectors.height,duration:vectors.duration_ms,
    children:tracks.map(t=>({kind:"shape",id:t.id,geometry:"path",pathData:t.steps[0].pathData,
      position:{x:0,y:0},size:{w:vectors.width,h:vectors.height},fill:t.hole?"#000":"#fff",
      opacity:t.steps[0].opacity})),
    animations:{show:{parallel:tracks.map(t=>({target:t.id,keyframes:{duration_ms:vectors.duration_ms,steps:t.steps}}))}},
    title:"OpenAI · Reference Motion",slug:"openai-reference",minimumRenderRate:45,
    capture:{fingerprint_interval_ms:100,minimum_distinct_frames:20,codec:"vp8"},
    description:"Rotoscopie vectorielle de la référence · poses mesurées à 30 Hz, morphing des contours stables, poses maintenues lors des fusions/séparations · rebonds et rotations conservés · fidélité à valider."};
}
