// Experimental Vision image deformation; two whole textures on continuous meshes.
export function waveScene(size) {
  const duration = 4200, samples = 126;
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
  const steps = Array.from({ length: samples + 1 }, (_, index) => {
    const t = index / samples;
    return { at: t,
      translateX: -size * smooth((t - .18) / .55),
      waveAmplitude: index === 0 || index === samples ? 0 : 68 * Math.sin(Math.PI * t) ** 2,
      wavePhase: -2 * Math.PI * 2.1 * t,
    };
  });
  const children = [
    { kind: "image", id: "wave-out", position: { x: 0, y: 0 }, size: { w: size, h: size }, src: "assets/w.png", fit: "fill" },
    { kind: "image", id: "wave-in", position: { x: size, y: 0 }, size: { w: size, h: size }, src: "assets/hello-fresh.png", fit: "fill" },
  ];
  const animations = {};
  for (const node of children) {
    Object.assign(node, { "x-vision.waveAmplitude": 0, "x-vision.wavePhase": 0,
      "x-vision.waveWavelength": size / 1.3, "x-vision.waveHarmonic": .23 });
    animations[node.id] = { target: node.id, keyframes: { duration_ms: duration, easing: "linear", steps } };
  }
  return { children, animations, duration,
    description: "2 images entières · onde continue sur maillage · 2 pistes · 4,2 s",
    title: "Sponsor Wave", slug: "sponsor-wave", minimumRenderRate: 50 };
}
