// Development fixture: sampled sine displacement, rendered as clipped LSML rows.
// This approximates a warp with existing primitives; it is not a mesh/shader API.
export function waveScene(size) {
  const count = 48, duration = 4200, samples = 64;
  const children = [], animations = {};
  const clamp = value => Math.max(0, Math.min(1, value));
  const smooth = value => { const t = clamp(value); return t * t * (3 - 2 * t); };
  for (let row = 0; row < count; row++) {
    const y = row * size / count, phase = row / (count - 1);
    const outgoing = `wave-out-${row}`, incoming = `wave-in-${row}`;
    for (const [id, image, pixels, x] of [[outgoing, "w", 512, 0], [incoming, "hello-fresh", 447, size]])
      children.push({ kind: "image", id, position: { x, y }, size: { w: size, h: size / count },
        src: `assets/${image}.png`, fit: "fill", srcRect: { x: 0, y: row * pixels / count, w: pixels, h: pixels / count } });
    const steps = Array.from({ length: samples + 1 }, (_, index) => {
      const t = index / samples;
      const travel = smooth((t - .22 - .07 * phase) / .48);
      // A traveling wave and its harmonic swell, then settle exactly at rest.
      const envelope = Math.sin(Math.PI * t) ** 2;
      const ripple = envelope * (78 * Math.sin(2 * Math.PI * (1.3 * phase - 2.2 * t))
        + 18 * Math.sin(2 * Math.PI * (2.6 * phase - 3.1 * t)));
      return { at: t, translateX: index === 0 ? 0 : index === samples ? -size : Number((-size * travel + ripple).toFixed(4)) };
    });
    for (const id of [outgoing, incoming]) animations[id] = {
      target: id, keyframes: { duration_ms: duration, easing: "linear", steps },
    };
  }
  // Whole-image bookends avoid integer source-crop rounding at rest.
  for (const [id, image, steps] of [
    ["wave-start", "w", [{ at: 0, opacity: 1 }, { at: .035, opacity: 0 }, { at: 1, opacity: 0 }]],
    ["wave-end", "hello-fresh", [{ at: 0, opacity: 0 }, { at: .965, opacity: 0 }, { at: 1, opacity: 1 }]],
  ]) {
    children.push({ kind: "image", id, position: { x: 0, y: 0 }, size: { w: size, h: size }, src: `assets/${image}.png`, fit: "fill", opacity: id === "wave-start" ? 1 : 0 });
    animations[id] = { target: id, keyframes: { duration_ms: duration, easing: "linear", steps } };
  }
  return { children, animations, duration, description: "48 bandes de 15 px · 98 pistes · onde progressive et harmonique · 4,2 s", title: "Sponsor Wave", slug: "sponsor-wave" };
}
