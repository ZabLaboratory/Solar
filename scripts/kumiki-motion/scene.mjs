// Original choreography; the canonical silhouette is traced once, never rotoscoped.
export function kumikiScene(vectors) {
  const width = 1280,
    height = 720,
    duration = 15000;
  const white = "#eef0f3",
    silver = "#cfd2d8",
    orange = "#f06a22";
  const children = [],
    tracks = [];
  const ease = "cubic-bezier(0.65,0,0.2,1)";
  const spring = { type: "spring", stiffness: 150, damping: 12, mass: 1 };
  const key = (ms, values, easing = ease) => ({
    at: ms / duration,
    ...values,
    easing,
  });
  const track = (target, keys) =>
    tracks.push({ target, keyframes: { duration_ms: duration, steps: keys } });
  const path = (points) =>
    "M" +
    points.map((p) => p.map((n) => n.toFixed(3)).join(" ")).join(" L") +
    " Z";
  const polar = (r, a) => [640 + r * Math.cos(a), 360 + r * Math.sin(a)];
  const shape = (id, data, style = {}) => ({
    kind: "shape",
    id,
    geometry: "path",
    pathData: data,
    position: { x: 0, y: 0 },
    size: { w: width, h: height },
    ...style,
  });
  const circle = (r) =>
    `M ${640 + r} 360 C ${640 + r} ${360 + r * 0.552285} ${640 + r * 0.552285} ${360 + r} 640 ${360 + r} C ${640 - r * 0.552285} ${360 + r} ${640 - r} ${360 + r * 0.552285} ${640 - r} 360 C ${640 - r} ${360 - r * 0.552285} ${640 - r * 0.552285} ${360 - r} 640 ${360 - r} C ${640 + r * 0.552285} ${360 - r} ${640 + r} ${360 - r * 0.552285} ${640 + r} 360 Z`;
  // A restrained instrument field, with one parent animation rather than per-dot tracks.
  const fieldPath = Array.from({ length: 171 }, (_, i) => {
    const x = 172 + (i % 19) * 52,
      y = 148 + Math.floor(i / 19) * 52;
    return `M ${x} ${y} L ${x + 2} ${y} L ${x + 2} ${y + 2} L ${x} ${y + 2} Z`;
  }).join(" ");
  children.push(shape("field", fieldPath, { opacity: 0, fill: "#41454d" }));
  track("field", [
    key(0, { opacity: 0, scale: 0.92 }),
    key(1800, { opacity: 0.35, scale: 1 }),
    key(5200, { opacity: 0.75, rotation: 8 }),
    key(9400, { opacity: 0.35, rotation: 0 }),
    key(12400, { opacity: 0 }),
    key(duration, { opacity: 0 }),
  ]);
  for (let i = 0; i < 3; i++) {
    const id = `orbit-${i}`;
    children.push(
      shape(id, circle(176 + i * 71), {
        opacity: 0,
        stroke: {
          color: i === 1 ? orange : "#59616d",
          width: i === 1 ? 1.5 : 1,
          lineCap: "round",
        },
        "x-vision.trimEnd": 0,
      }),
    );
    track(id, [
      key(0, {
        opacity: 0,
        trimStart: 0,
        trimEnd: 0,
        rotation: i * 120,
        scale: 0.2,
      }),
      key(1900 + i * 180, { opacity: 0, trimEnd: 0, scale: 0.4 }),
      key(3500 + i * 180, { opacity: 0.65, trimEnd: 0.82, scale: 1 }),
      key(6800, {
        trimStart: 0.17,
        trimEnd: 0.98,
        rotation: 240 + i * 120,
        scale: 1.05,
      }),
      key(9200, {
        opacity: 0.65,
        trimStart: 0.4,
        trimEnd: 1,
        rotation: 450 + i * 120,
        scale: 0.9,
      }),
      key(10800, { opacity: 0, trimStart: 1, trimEnd: 1, scale: 0.5 }),
      key(duration, { opacity: 0 }),
    ]);
  }
  // Thirty-six radial contacts share three phase-shifted impact-wave rigs.
  const ticks = [];
  for (let group = 0; group < 3; group++) {
    const id = `contact-wave-${group}`;
    const data = Array.from({ length: 12 }, (_, j) => {
      const a = ((j * 3 + group) * Math.PI) / 18,
        [x, y] = polar(304, a);
      return path(
        [
          [-2, -7],
          [2, -7],
          [2, 7],
          [-2, 7],
        ].map(([u, v]) => [
          x + u * Math.cos(a) - v * Math.sin(a),
          y + u * Math.sin(a) + v * Math.cos(a),
        ]),
      );
    }).join(" ");
    ticks.push(
      shape(id, data, { fill: group === 0 ? orange : silver, opacity: 0 }),
    );
    const start = 3000 + group * 180;
    track(id, [
      key(0, { opacity: 0, scale: 0.3, rotation: 0 }),
      key(start, { opacity: 0, scale: 0.3 }),
      key(start + 800, { opacity: 0.8, scale: 1 }, spring),
      key(6000 + group * 140, { opacity: 0.35, rotation: 90, scale: 0.65 }),
      key(8300 + group * 180, { opacity: 0.9, scale: 1.1 }, spring),
      key(10600 + group * 90, { opacity: 0, scale: 0.15 }),
      key(duration, { opacity: 0 }),
    ]);
  }
  children.push({
    kind: "frame",
    id: "contacts",
    size: { w: width, h: height },
    children: ticks,
  });
  track("contacts", [
    key(0, { rotation: 0 }),
    key(3000, { rotation: 0 }),
    key(8200, { rotation: 155 }),
    key(11000, { rotation: 230 }),
    key(duration, { rotation: 230 }),
  ]);
  // Six three-dot constellations run along staggered individual cubic routes.
  const flights = [];
  for (let i = 0; i < 6; i++) {
    const id = `satellite-${i}`,
      a = (i * Math.PI) / 3,
      p = polar(350, a),
      q = polar(215, a + 2.1),
      end = polar(32, a + 4.2);
    children.push({
      kind: "frame",
      id,
      position: { x: 0, y: 0 },
      size: { w: 1, h: 1 },
      opacity: 0,
      children: Array.from({ length: 3 }, (_, j) => ({
        kind: "shape",
        id: `satellite-${i}-tail-${j}`,
        geometry: "circle",
        position: { x: -3 - j * 14, y: -3 + j * 4 },
        size: { w: 6 - j * 1.2, h: 6 - j * 1.2 },
        fill: i % 3 === 0 ? orange : white,
        opacity: 1 - j * 0.28,
      })),
    });
    flights.push({
      target: id,
      delay_ms: i * 48,
      keyframes: {
        duration_ms: 5000,
        steps: [
          { at: 0, opacity: 0, scale: 0.3, easing: "ease-out" },
          { at: 0.13, opacity: 0.85, scale: 1 },
          { at: 0.6, opacity: 0.7, scale: 0.55 },
          { at: 0.9, opacity: 1, scale: 1.2 },
          { at: 1, opacity: 0, scale: 0 },
        ],
      },
      motion_path: {
        points: [
          p,
          [p[0] + 180 * Math.sin(a), p[1] - 180 * Math.cos(a)],
          [q[0] - 120 * Math.cos(a), q[1] - 120 * Math.sin(a)],
          q,
          [q[0] + 120, q[1] - 170],
          [end[0] - 160, end[1] + 90],
          end,
        ],
        orient: false,
        easing: "ease-in-out",
      },
    });
  }
  // Logo rig: three independently deformable bands within a common presentation frame.
  const bands = [];
  for (let i = 0; i < 3; i++) {
    const canonical = vectors.bands[i].map(([x, y]) => [
      640 + (x - 627) * 0.4,
      350 + (y - 595) * 0.4,
    ]);
    const finalPath = path(canonical),
      angle = (i * 2 * Math.PI) / 3 - Math.PI / 2;
    const ribbon = (phase, amp, thin = 1) =>
      path(
        Array.from({ length: 256 }, (_, j) => {
          const t = j < 128 ? j / 127 : (255 - j) / 127,
            side = j < 128 ? 1 : -1;
          const x = (t - 0.5) * 450,
            y =
              Math.sin(t * Math.PI * 2 + phase) * amp +
              side * 12 * thin * Math.sin(Math.PI * t) ** 0.22;
          return [640 + x, 350 + y];
        }),
      );
    const wave1 = ribbon(i * 1.8, 48),
      wave2 = ribbon(i * 1.8 + Math.PI, 70),
      line = ribbon(0, 0, 0.5);
    const id = `band-${i}`,
      outline = `trace-${i}`;
    bands.push(
      shape(outline, finalPath, {
        opacity: 0,
        stroke: {
          color: i === 0 ? orange : silver,
          width: 1.3,
          lineCap: "round",
          lineJoin: "round",
        },
        "x-vision.trimEnd": 0,
      }),
    );
    track(outline, [
      key(0, { opacity: 0, trimEnd: 0 }),
      key(180 + i * 160, { opacity: 1, trimEnd: 0 }),
      key(1450 + i * 120, { trimEnd: 1, opacity: 0.9 }),
      key(2150, { opacity: 0 }),
      key(duration, { opacity: 0 }),
    ]);
    bands.push(shape(id, finalPath, { fill: white, opacity: 0 }));
    track(id, [
      key(0, {
        opacity: 0,
        pathData: finalPath,
        scale: 1,
        rotation: 0,
        translateX: 0,
        translateY: 0,
        fill: white,
      }),
      key(1050 + i * 180, { opacity: 0 }),
      key(1900 + i * 80, { opacity: 1 }, spring),
      key(2500, {
        scale: 1.06,
        rotation: 0,
        fill: white,
        translateX: 0,
        translateY: 0,
      }),
      key(2900, { scale: 0.92, translateX: 0, translateY: 0 }, spring),
      key(3900 + i * 70, {
        pathData: finalPath,
        translateX: Math.cos(angle) * 156,
        translateY: Math.sin(angle) * 146,
        rotation: i * 120 - 30,
        scale: 0.82,
        fill: i === 0 ? orange : silver,
      }),
      key(4700 + i * 80, { pathData: wave1, scale: 1, rotation: i * 120 - 30 }),
      key(6300, {
        pathData: wave2,
        rotation: i * 120 + 125,
        translateX: Math.cos(angle + 2) * 110,
        translateY: Math.sin(angle + 2) * 95,
      }),
      key(8000, {
        pathData: wave1,
        rotation: i * 120 + 290,
        translateX: Math.cos(angle + 4) * 145,
        translateY: Math.sin(angle + 4) * 115,
      }),
      key(9100 + i * 70, {
        pathData: line,
        rotation: i * 120 + 360,
        translateX: Math.cos(angle) * 170,
        translateY: Math.sin(angle) * 70,
        scale: 0.66,
      }),
      key(10150 + i * 100, {
        pathData: wave1,
        rotation: 360,
        translateX: 0,
        translateY: (i - 1) * 90,
        scale: 0.7,
      }),
      key(11350 + i * 110, {
        pathData: finalPath,
        rotation: 360,
        translateX: 0,
        translateY: 0,
        scale: 1.05,
        fill: i === 0 ? orange : white,
      }),
      key(12500, { scale: 1, fill: white }, spring),
      key(duration, { scale: 1, rotation: 360, fill: white }),
    ]);
  }
  children.push({
    kind: "frame",
    id: "assembly",
    size: { w: width, h: height },
    children: bands,
  });
  track("assembly", [
    key(0, { scale: 0.96 }),
    key(2200, { scale: 1 }),
    key(5000, { scale: 1 }),
    key(7600, { scale: 0.93 }),
    key(9500, { scale: 1.08 }),
    key(11600, { scale: 1 }),
    key(12000, { scale: 1.035 }, spring),
    key(12400, { scale: 0.72, translateX: -275, rotation: 360 }, spring),
    key(13500, { scale: 0.72, translateX: -275, rotation: 360 }, spring),
    key(duration, { scale: 0.72, translateX: -275, rotation: 360 }),
  ]);
  // The mark resolves into Kumiki's canonical wordmark and two-line hero signature.
  const word = (id, value, x, y, w, size, colour, weight, tracking) => ({
    kind: "text",
    id,
    value,
    position: { x, y },
    size: { w, h: size * 1.25 },
    opacity: 0,
    style: {
      fontFamily: "Recursive, Figtree, sans-serif",
      fontSize: size,
      fontWeight: weight,
      color: colour,
      letterSpacing: tracking,
      lineHeight: 0.96,
    },
  });
  children.push(
    word("brand-wordmark", "Kumiki", 630, 254, 610, 86, white, 650, -4),
  );
  children.push(
    word(
      "brand-signature-first",
      "Many systems.",
      632,
      374,
      610,
      56,
      "#cfd2d8",
      520,
      -2.2,
    ),
  );
  children.push(
    word(
      "brand-signature-second",
      "One motion.",
      632,
      440,
      610,
      56,
      "#b8bdc8",
      520,
      -2.2,
    ),
  );
  track("brand-wordmark", [
    key(0, { opacity: 0, translateX: 30, translateY: 8, scale: 0.96 }),
    key(12280, { opacity: 0 }),
    key(12450, { opacity: 1, translateX: 0, translateY: 0, scale: 1 }, spring),
    key(13300, { opacity: 1, translateX: 0, translateY: 0, scale: 1 }),
    key(duration, { opacity: 1 }),
  ]);
  track("brand-signature-first", [
    key(0, { opacity: 0, translateY: 14 }),
    key(12550, { opacity: 0 }),
    key(12900, { opacity: 1, translateY: 0 }, spring),
    key(13400, { opacity: 1 }),
    key(duration, { opacity: 1 }),
  ]);
  track("brand-signature-second", [
    key(0, { opacity: 0, translateY: 14 }),
    key(12900, { opacity: 0 }),
    key(13250, { opacity: 1, translateY: 0 }, spring),
    key(13700, { opacity: 1 }),
    key(duration, { opacity: 1 }),
  ]);
  for (let i = 0; i < 3; i++) {
    const id = `lock-echo-${i}`;
    children.push(
      shape(id, circle(152), {
        opacity: 0,
        stroke: { color: i === 0 ? orange : silver, width: 1.3 },
      }),
    );
    track(id, [
      key(0, { opacity: 0, scale: 0.85 }),
      key(11400 + i * 170, { opacity: 0, scale: 0.85 }),
      key(11700 + i * 170, { opacity: 0.55, scale: 1 }),
      key(13000 + i * 210, { opacity: 0, scale: 2.1 }),
      key(duration, { opacity: 0, scale: 2.1 }),
    ]);
  }
  return {
    width,
    height,
    duration,
    children,
    animations: {
      show: {
        parallel: [{ parallel: tracks }, { delay_ms: 3600, parallel: flights }],
      },
    },
    title: "Kumiki · Many systems. One motion.",
    slug: "kumiki-unweave",
    minimumRenderRate: 45,
    capture: {
      fingerprint_interval_ms: 100,
      minimum_distinct_frames: 60,
      codec: "vp8",
    },
    description:
      "Dénouement, rubans ondulatoires, ballet orbital et assemblage du nom Kumiki avec sa signature Many systems. One motion. Une chorégraphie originale en cinq actes.",
  };
}
