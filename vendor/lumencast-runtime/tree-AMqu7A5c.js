import { jsx as d, jsxs as C, Fragment as et } from "react/jsx-runtime";
import { useSignals as fe } from "@preact/signals-react/runtime";
import { motion as xt, useMotionValue as dt, useTransform as Bn, animate as we } from "framer-motion";
import { Fragment as dn, useRef as kt, useState as Wt, useEffect as ht, useId as Cn, useContext as Nt, createContext as de, useCallback as Pn, useMemo as ut, memo as Ln } from "react";
import { e as E, g as Yt, a as Tt, b as Et, c as Gt, m as Vt, t as At, d as $t, f as st, h as ft, n as In, M as _t, i as Dn, j as he, s as zn, w as hn, F as Un, k as pn } from "./index-DYoYgjoZ.js";
import { CAPTURE_VISUAL_KINDS as Hn, checkHostAllowed as Wn } from "@lumencast/protocol";
import { effect as Yn } from "@preact/signals-react";
function Gn({ resolved: t, children: e, establishesContainingBlock: n }) {
  const i = t.direction ?? "vertical", r = ve(t.gap, 0), o = t.wrap === !0, s = ve(t.crossGap, 0), c = t.align ?? "stretch", a = t.justify ?? "flex-start", l = i === "horizontal", u = {
    display: "flex",
    flexDirection: l ? "row" : "column",
    alignItems: c,
    justifyContent: a,
    // ADR 002 §3.1 (D1) — establish a containing block when a child is
    // absolutely placed, so its `left/top` resolve against this stack.
    // Untouched for pure auto-layout stacks (RC#2).
    ...n ? { position: "relative" } : {}
  };
  return o ? (u.flexWrap = "wrap", l ? (u.columnGap = r, u.rowGap = s) : (u.rowGap = r, u.columnGap = s)) : u.gap = r, /* @__PURE__ */ d("div", { style: u, children: e });
}
function ve(t, e) {
  return typeof t == "number" && Number.isFinite(t) ? t : e;
}
function Vn({ resolved: t, children: e, establishesContainingBlock: n }) {
  const i = t.cols ?? "1fr", r = t.rows ?? "auto", o = t.gap ?? 0;
  return /* @__PURE__ */ d(
    "div",
    {
      style: {
        display: "grid",
        gridTemplateColumns: i,
        gridTemplateRows: r,
        gap: o,
        // ADR 002 §3.1 (D1) — establish a containing block for absolutely
        // placed children ; untouched for pure auto-layout grids (RC#2).
        ...n ? { position: "relative" } : {}
      },
      children: e
    }
  );
}
const Xn = 64, qn = /^[#a-zA-Z0-9(),.% ]{1,64}$/, Kn = /^#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/, bt = String.raw`\d{1,3}(?:\.\d{1,4})?`, mn = String.raw`(?:0|1|0?\.\d{1,4}|${bt}%)`, K = String.raw`[ ]{0,4}`, Zn = new RegExp(
  `^rgba?\\(${K}(${bt})(%?)${K},${K}(${bt})(%?)${K},${K}(${bt})(%?)${K}(?:,${K}${mn}${K})?\\)$`
), Jn = new RegExp(
  `^hsla?\\(${K}(${bt})(?:deg)?${K},${K}(${bt})%${K},${K}(${bt})%${K}(?:,${K}${mn}${K})?\\)$`
), Qn = new Set(
  "aliceblue antiquewhite aqua aquamarine azure beige bisque black blanchedalmond blue blueviolet brown burlywood cadetblue chartreuse chocolate coral cornflowerblue cornsilk crimson cyan darkblue darkcyan darkgoldenrod darkgray darkgreen darkgrey darkkhaki darkmagenta darkolivegreen darkorange darkorchid darkred darksalmon darkseagreen darkslateblue darkslategray darkslategrey darkturquoise darkviolet deeppink deepskyblue dimgray dimgrey dodgerblue firebrick floralwhite forestgreen fuchsia gainsboro ghostwhite gold goldenrod gray green greenyellow grey honeydew hotpink indianred indigo ivory khaki lavender lavenderblush lawngreen lemonchiffon lightblue lightcoral lightcyan lightgoldenrodyellow lightgray lightgreen lightgrey lightpink lightsalmon lightseagreen lightskyblue lightslategray lightslategrey lightsteelblue lightyellow lime limegreen linen magenta maroon mediumaquamarine mediumblue mediumorchid mediumpurple mediumseagreen mediumslateblue mediumspringgreen mediumturquoise mediumvioletred midnightblue mintcream mistyrose moccasin navajowhite navy oldlace olive olivedrab orange orangered orchid palegoldenrod palegreen paleturquoise palevioletred papayawhip peachpuff peru pink plum powderblue purple rebeccapurple red rosybrown royalblue saddlebrown salmon sandybrown seagreen seashell sienna silver skyblue slateblue slategray slategrey snow springgreen steelblue tan teal thistle tomato turquoise violet wheat white whitesmoke yellow yellowgreen transparent currentcolor".split(" ")
);
function it(t) {
  if (typeof t != "string") return null;
  const e = t.trim();
  if (e.length === 0 || e.length > Xn) return null;
  const n = e.toLowerCase();
  if (n.includes("url(") || e.includes(";") || e.includes("}") || !qn.test(e)) return null;
  if (e.startsWith("#")) return Kn.test(e) ? e : null;
  if (n.startsWith("rgb")) {
    const i = Zn.exec(n);
    if (!i) return null;
    const r = [i[2], i[4], i[6]];
    if (!(r.every((s) => s === "%") || r.every((s) => s === ""))) return null;
    const o = r[0] === "%" ? 100 : 255;
    for (const s of [i[1], i[3], i[5]])
      if (Number(s) > o) return null;
    return n;
  }
  if (n.startsWith("hsl")) {
    const i = Jn.exec(n);
    return !i || Number(i[1]) > 360 || Number(i[2]) > 100 || Number(i[3]) > 100 ? null : n;
  }
  return Qn.has(n) ? n : null;
}
function rt(t, e) {
  E(
    e,
    t,
    "rejected unsafe colour : not a strict hex/rgb()/hsl()/named colour"
  );
}
const ti = /* @__PURE__ */ new Set([
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
  "difference",
  "exclusion",
  "hue",
  "saturation",
  "color",
  "luminosity",
  // Figma LINEAR_DODGE (add) — exact additive blend, gentler than color-dodge.
  "plus-lighter"
]);
function tt(t) {
  return typeof t == "string" && ti.has(t) ? t : void 0;
}
const ei = /* @__PURE__ */ new Set(["cover", "contain", "fill", "none", "scale-down"]);
function ni(t) {
  return typeof t == "string" && ei.has(t) ? t : void 0;
}
let Zt = 0;
function Se() {
  return Zt = (Zt + 1) % 1e6, `lumen-grad-${Zt.toString(36)}`;
}
function Lt(t, e = {}) {
  const n = tt(t.blendMode);
  if (t.kind === "solid") {
    const l = wt(t.opacity) ? oe(t.color, t.opacity) : t.color;
    return { defs: [], ref: l, mixBlendMode: n };
  }
  if (t.kind === "image") {
    const l = Se(), u = ri(t.objectFit);
    return { defs: [
      /* @__PURE__ */ d("pattern", { id: l, patternContentUnits: "objectBoundingBox", width: "1", height: "1", children: /* @__PURE__ */ d(
        "image",
        {
          href: t.src,
          width: "1",
          height: "1",
          preserveAspectRatio: u,
          ...wt(t.opacity) ? { opacity: t.opacity } : {}
        }
      ) }, l)
    ], ref: `url(#${l})`, mixBlendMode: n };
  }
  const i = Se();
  if (t.kind === "linear-gradient") {
    let l, u, f, p, m, h;
    const k = t.transform, v = e.invertGradientTransform ? Me(k) : k;
    if (Array.isArray(v) && v.length === 6 && v.every((y) => typeof y == "number" && Number.isFinite(y))) {
      const y = e.authoredBox;
      if (y !== void 0 && It(y.width) && It(y.height)) {
        const [g, $, T, w, x, S] = v;
        h = "userSpaceOnUse", l = x * y.width, u = S * y.height, f = (x + g) * y.width, p = (S + $) * y.height;
      } else
        l = 0, u = 0, f = 1, p = 0, m = `matrix(${v.join(" ")})`;
    } else {
      const g = ((t.angle_deg ?? 0) - 90) * Math.PI / 180;
      l = 0.5 - 0.5 * Math.cos(g), u = 0.5 - 0.5 * Math.sin(g), f = 0.5 + 0.5 * Math.cos(g), p = 0.5 + 0.5 * Math.sin(g);
    }
    return { defs: [
      /* @__PURE__ */ d(
        "linearGradient",
        {
          id: i,
          x1: h === void 0 ? `${l * 100}%` : String(l),
          y1: h === void 0 ? `${u * 100}%` : String(u),
          x2: h === void 0 ? `${f * 100}%` : String(f),
          y2: h === void 0 ? `${p * 100}%` : String(p),
          ...h !== void 0 ? { gradientUnits: h } : {},
          ...m !== void 0 ? { gradientTransform: m } : {},
          children: t.stops.map((y, g) => /* @__PURE__ */ d(
            "stop",
            {
              offset: y.offset,
              stopColor: y.color,
              ...$e(t.opacity, y.opacity)
            },
            g
          ))
        },
        i
      )
    ], ref: `url(#${i})`, mixBlendMode: n };
  }
  const r = t.center?.x ?? 0.5, o = t.center?.y ?? 0.5, s = t.radius ?? 0.5, c = Array.isArray(t.transform) && t.transform.length === 6 && t.transform.every((l) => typeof l == "number" && Number.isFinite(l)) ? e.invertGradientTransform ? Me(t.transform) : t.transform : void 0;
  return { defs: [
    /* @__PURE__ */ d(
      "radialGradient",
      {
        id: i,
        cx: `${r * 100}%`,
        cy: `${o * 100}%`,
        r: `${s * 100}%`,
        ...c !== void 0 ? { gradientTransform: `matrix(${c.join(" ")})` } : {},
        children: t.stops.map((l, u) => /* @__PURE__ */ d(
          "stop",
          {
            offset: l.offset,
            stopColor: l.color,
            ...$e(t.opacity, l.opacity)
          },
          u
        ))
      },
      i
    )
  ], ref: `url(#${i})`, mixBlendMode: n };
}
function ii(t) {
  switch (t) {
    case "contain":
    case "scale-down":
      return "contain";
    case "none":
      return "auto";
    case "fill":
      return "100% 100%";
    case "cover":
    default:
      return "cover";
  }
}
function ri(t) {
  switch (t) {
    case "contain":
    case "scale-down":
      return "xMidYMid meet";
    case "fill":
      return "none";
    case "none":
      return "xMidYMid meet";
    case "cover":
    default:
      return "xMidYMid slice";
  }
}
function Xt(t, e, n = {}) {
  const i = [], r = [];
  for (const a of t) {
    const l = si(a, e, n);
    l && (r.push(l), i.push(a));
  }
  if (r.length === 0) return {};
  const o = { backgroundImage: r.join(", ") }, s = i.map((a) => tt(a.blendMode) ?? "normal");
  s.some((a) => a !== "normal") && (o.backgroundBlendMode = s.join(", "));
  const c = t.find((a) => a.kind === "image");
  return c && (o.backgroundSize = ii(c.objectFit), o.backgroundPosition = "center", o.backgroundRepeat = "no-repeat"), o;
}
function oi(t) {
  return `url("${t.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}")`;
}
function si(t, e, n = {}) {
  if (t.kind === "image")
    return oi(t.src);
  if (t.kind === "solid") {
    const c = it(t.color);
    if (c === null)
      return rt("fill.color", e), null;
    const a = wt(t.opacity) ? oe(c, t.opacity) : c;
    return `linear-gradient(${a}, ${a})`;
  }
  const i = [];
  for (const c of t.stops) {
    const a = it(c.color);
    if (a === null)
      return rt("fill.stops.color", e), null;
    const l = ai(t.opacity, c.opacity), u = l !== void 0 ? oe(a, l) : a;
    i.push({ css: u, offset: c.offset });
  }
  if (t.kind === "linear-gradient") {
    let c = t.angle_deg ?? 0, a = i.map(({ css: u, offset: f }) => `${u} ${(f * 100).toFixed(2)}%`);
    const l = t.transform;
    if (Array.isArray(l) && l.length === 6 && l.every((u) => typeof u == "number" && Number.isFinite(u))) {
      const [u, f, p, m, h, k] = l, v = It(n.boxWidth) ? n.boxWidth : 1, b = It(n.boxHeight) ? n.boxHeight : 1, y = u * v, g = f * b, $ = h * v, T = k * b, w = Math.hypot(y, g);
      if (w > Number.EPSILON) {
        c = (Math.atan2(y, -g) * 180 / Math.PI + 360) % 360;
        const x = y / w, S = g / w, O = [0, v * x, b * S, v * x + b * S], z = Math.min(...O), j = Math.max(...O) - z, D = $ * x + T * S;
        j > Number.EPSILON && Number.isFinite(D) && (a = i.map(({ css: P, offset: X }) => {
          const R = (D + X * w - z) / j * 100;
          return `${P} ${R.toFixed(4)}%`;
        }));
      }
    }
    return `linear-gradient(${c}deg, ${a.join(", ")})`;
  }
  const r = i.map(({ css: c, offset: a }) => `${c} ${(a * 100).toFixed(2)}%`).join(", "), o = (t.center?.x ?? 0.5) * 100, s = (t.center?.y ?? 0.5) * 100;
  return `radial-gradient(circle at ${o}% ${s}%, ${r})`;
}
function oe(t, e) {
  const n = t.match(/^#([0-9a-f]{6})$/i);
  if (n) {
    const i = Math.round(e * 255).toString(16).padStart(2, "0");
    return `#${n[1]}${i}`;
  }
  return `color-mix(in srgb, ${t} ${e * 100}%, transparent)`;
}
function $e(t, e) {
  const n = wt(t) ? t : 1, i = wt(e) ? e : 1, r = n * i;
  return r < 1 ? { stopOpacity: r } : {};
}
function wt(t) {
  return typeof t == "number" && Number.isFinite(t) && t >= 0 && t <= 1;
}
function It(t) {
  return typeof t == "number" && Number.isFinite(t) && t > 0;
}
function ai(t, e) {
  if (t === void 0 && e === void 0) return;
  const n = wt(t) ? t : 1, i = wt(e) ? e : 1;
  return n * i;
}
function Me(t) {
  if (!Array.isArray(t) || t.length !== 6 || !t.every((a) => typeof a == "number" && Number.isFinite(a)))
    return t;
  const [e, n, i, r, o, s] = t, c = e * r - n * i;
  if (!(!Number.isFinite(c) || Math.abs(c) < 1e-8))
    return [
      r / c,
      -n / c,
      -i / c,
      e / c,
      (i * s - r * o) / c,
      (n * o - e * s) / c
    ];
}
function Dt(t, e, n) {
  const i = [];
  for (const r of t) {
    if (r.kind === "image") {
      i.push(r);
      continue;
    }
    if (r.kind === "solid") {
      const c = it(r.color);
      if (c === null) {
        rt(`${e}.color`, n);
        continue;
      }
      i.push({ ...r, color: c });
      continue;
    }
    const o = [];
    let s = !1;
    for (const c of r.stops ?? []) {
      const a = it(c.color);
      if (a === null) {
        rt(`${e}.stops.color`, n), s = !0;
        break;
      }
      o.push({ ...c, color: a });
    }
    s || i.push({ ...r, stops: o });
  }
  return i;
}
function Ot(t, e, n) {
  if (!Array.isArray(t)) return [];
  if (e !== void 0)
    for (const i of t)
      Ae(i) || E(
        n,
        `${e}.kind`,
        "fill kind is not renderable by this runtime ; layer dropped (angular/diamond gradients land with LSML 1.2)"
      );
  return t.filter(Ae).map((i) => {
    let r = i;
    if (r.blendMode !== void 0 && tt(r.blendMode) === void 0) {
      E(
        n,
        e !== void 0 ? `${e}.blendMode` : "fill.blendMode",
        "is not a recognised mix-blend-mode ; falling back to normal (ADR 002 §3.2)"
      );
      const { blendMode: s, ...c } = r;
      r = c;
    }
    if (r.kind !== "image" || r.objectFit === void 0) return r;
    const o = ni(r.objectFit);
    if (o === void 0) {
      E(
        n,
        e !== void 0 ? `${e}.objectFit` : "fill.objectFit",
        "is not a recognised object-fit ; falling back to default (ADR 002 §3.2)"
      );
      const { objectFit: s, ...c } = r;
      return c;
    }
    return { ...r, objectFit: o };
  });
}
function Ae(t) {
  if (typeof t != "object" || t === null) return !1;
  const e = t.kind;
  return e === "solid" || e === "linear-gradient" || e === "radial-gradient" ? !0 : e === "image" && typeof t.src == "string";
}
function se(t, e, n, i, r) {
  return t.filter((o) => o.kind !== "image" ? !0 : Yt(o.src, e, `${n}.src`, i, r) !== void 0);
}
function li({
  resolved: t,
  nodeId: e,
  transitionFor: n,
  animateInitial: i,
  staticRender: r = !1,
  keyframed: o = !1,
  children: s
}) {
  const c = J(t.x, 0), a = J(t.y, 0), l = Re(t.width), u = Re(t.height), f = J(t.opacity, 1), p = J(t.scale, 1), m = J(t.rotate, J(t.rotation, 0)), h = t.flipY === !0, k = J(t.radius, 0), v = J(t.width, 0), b = J(t.height, 0), y = v > 0 && b > 0 ? Math.min(k, v / 2, b / 2) : k, g = t.background, $ = g === void 0 ? void 0 : it(g);
  g !== void 0 && $ === null && rt("frame.background", e);
  const T = Tt(), w = Et(), x = se(
    Ot(t.backgrounds, "frame.backgrounds", e),
    T,
    "frame.backgrounds",
    e,
    w
  ), S = ui(t.clipsContent, e), O = Gt(
    n,
    ["opacity", "scale", "rotate", "x", "y"],
    i
  ), z = i !== void 0 && Object.keys(i).length > 0, j = O === void 0 && !z && !o, D = r && j && p === 1 && m === 0 && !h, P = {
    position: "absolute",
    left: j ? c : 0,
    top: j ? a : 0,
    ...D ? { transform: "none" } : {},
    width: l,
    height: u,
    // Keep the authored static frame opacity in the DOM. Framer Motion's
    // initial/animate props do not reliably materialize an unchanged opacity
    // on non-animated nodes, which otherwise promotes authored 0.1 groups to
    // fully opaque layers.
    opacity: f,
    // NB: NO permanent `will-change`. `will-change: opacity` makes the frame an
    // isolated group (the browser pre-promotes it as if opacity < 1), which
    // CONTAINS any descendant `mix-blend-mode` to the frame's own backdrop — so
    // a screen/hard-light layer (Sunshine, Ruby20) silently stops compositing
    // with the scene below. The hint also belongs only on actively-animating
    // nodes (bind-animate adds it there) ; a static board doesn't need it.
    // LSML 1.1 §4.3 `clipsContent` (default `true`) — children outside
    // the frame's `size` are clipped. Static layout property : it never
    // animates, so it stays off the 0-layout-event hot path (ADR 001
    // §3.2.5). `false` => omit the declaration (CSS initial = visible).
    ...S ? { overflow: "hidden" } : {},
    ...y > 0 ? { borderRadius: y } : {}
  }, X = x.some((F) => F.kind === "image"), R = x.some(
    (F) => F.kind === "linear-gradient" && Array.isArray(F.transform) && F.transform.length === 6
  );
  x.length > 0 ? !X && !R && Object.assign(P, Xt(x, e)) : $ != null && (P.background = $);
  const {
    filter: M,
    boxShadow: I,
    blendedBoxShadows: N
  } = fi(t.shadow, e), U = di(t.frameStroke, e), Z = U === void 0 ? void 0 : hi(U), L = X || R, G = [Z, I].filter((F) => F !== void 0).join(", ");
  !L && G !== "" && (P.boxShadow = G), M !== void 0 && (P.filter = M);
  const B = Vt(
    {
      opacity: f,
      ...j ? {} : { x: c, y: a },
      scale: p,
      rotate: m,
      ...h ? { scaleY: -1 } : {}
    },
    i,
    e
  ), W = D ? "div" : xt.div;
  return /* @__PURE__ */ C(
    W,
    {
      style: P,
      ...D ? {} : { initial: B.initial, animate: B.animate, transition: At(O) },
      children: [
        L && /* @__PURE__ */ d(
          ci,
          {
            fills: x,
            nodeId: e,
            radius: y,
            boxShadow: G,
            blendedBoxShadows: N
          }
        ),
        !L && N.length > 0 && /* @__PURE__ */ d(gn, { radius: y, shadows: N }),
        s
      ]
    }
  );
}
function ci({
  fills: t,
  nodeId: e,
  radius: n,
  boxShadow: i,
  blendedBoxShadows: r
}) {
  return /* @__PURE__ */ C(
    "div",
    {
      "aria-hidden": "true",
      style: {
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        ...n > 0 ? { borderRadius: n, overflow: "hidden" } : {}
      },
      children: [
        [...t].reverse().map((o, s) => {
          if (o.kind === "linear-gradient" && Array.isArray(o.transform) && o.transform.length === 6) {
            const u = Lt(o), f = tt(u.mixBlendMode);
            return /* @__PURE__ */ C(
              "svg",
              {
                "aria-hidden": "true",
                viewBox: "0 0 1 1",
                preserveAspectRatio: "none",
                style: {
                  position: "absolute",
                  inset: 0,
                  width: "100%",
                  height: "100%",
                  pointerEvents: "none",
                  ...f !== void 0 ? { mixBlendMode: f } : {}
                },
                children: [
                  /* @__PURE__ */ d("defs", { children: u.defs }),
                  /* @__PURE__ */ d("rect", { x: "0", y: "0", width: "1", height: "1", fill: u.ref })
                ]
              },
              `background-layer-${t.length - 1 - s}`
            );
          }
          const a = {
            position: "absolute",
            inset: 0,
            pointerEvents: "none",
            ...Xt([o], e)
          };
          o.kind === "image" && typeof o.opacity == "number" && Number.isFinite(o.opacity) && o.opacity >= 0 && o.opacity <= 1 && (a.opacity = o.opacity);
          const l = tt(o.blendMode);
          return l !== void 0 && (a.mixBlendMode = l), /* @__PURE__ */ d(
            "div",
            {
              "aria-hidden": "true",
              style: a
            },
            `background-layer-${t.length - 1 - s}`
          );
        }),
        i !== "" && /* @__PURE__ */ d(
          "div",
          {
            "aria-hidden": "true",
            style: {
              position: "absolute",
              inset: 0,
              pointerEvents: "none",
              // Chromium paints an inset shadow underneath an element's
              // background and descendants. Keep it on a final, nearly
              // transparent overlay so it composites above affine SVG/image
              // fills instead of disappearing behind them.
              background: "rgba(255, 255, 255, 0.0001)",
              ...n > 0 ? { borderRadius: n } : {},
              boxShadow: i,
              zIndex: 1
            }
          }
        ),
        r.length > 0 && /* @__PURE__ */ d(gn, { radius: n, shadows: r })
      ]
    }
  );
}
function gn({ radius: t, shadows: e }) {
  return /* @__PURE__ */ d(et, { children: e.map((n, i) => /* @__PURE__ */ d(
    "div",
    {
      "aria-hidden": "true",
      style: {
        position: "absolute",
        inset: 0,
        pointerEvents: "none",
        background: "rgba(255, 255, 255, 0.0001)",
        ...t > 0 ? { borderRadius: t } : {},
        boxShadow: n.css,
        mixBlendMode: n.blendMode,
        zIndex: 2 + i
      }
    },
    `shadow-overlay-${i}`
  )) });
}
function ui(t, e) {
  return t === void 0 ? !0 : typeof t == "boolean" ? t : (E(e, "frame.clipsContent", "rejected value : not a boolean"), !0);
}
function J(t, e) {
  return typeof t == "number" && Number.isFinite(t) ? t : e;
}
function fi(t, e) {
  if (!Array.isArray(t) || t.length === 0) return { blendedBoxShadows: [] };
  const n = [], i = [], r = [];
  for (const s of t) {
    if (typeof s != "object" || s === null) continue;
    const c = s, a = typeof c.color == "string" ? it(c.color) : null;
    if (a === null) {
      rt("frame.shadow.color", e);
      continue;
    }
    const l = c.inset === !0, u = $t("shadowOffset", J(c.x, 0)) ?? 0, f = $t("shadowOffset", J(c.y, 0)) ?? 0, p = st("blur", J(c.blur, 0)) ?? 0, m = $t("shadowSpread", J(c.spread, 0)) ?? 0;
    if (!l && m === 0)
      n.push(`drop-shadow(${u}px ${f}px ${p / 2.16}px ${a})`);
    else {
      const k = `${l ? "inset " : ""}${u}px ${f}px ${p}px ${m}px ${a}`, v = tt(c.blendMode) ?? "normal";
      v !== "normal" ? r.unshift({ css: k, blendMode: v }) : i.unshift(k);
    }
  }
  const o = {
    blendedBoxShadows: r
  };
  return n.length > 0 && (o.filter = n.join(" ")), i.length > 0 && (o.boxShadow = i.join(", ")), o;
}
function di(t, e) {
  if (typeof t != "object" || t === null || Array.isArray(t)) return;
  const n = t;
  if (typeof n.color != "string") {
    E(e, "frame.frameStroke", "rejected value : color is not a string");
    return;
  }
  const i = it(n.color);
  if (i === null) {
    rt("frame.frameStroke.color", e);
    return;
  }
  if (typeof n.width != "number" || !Number.isFinite(n.width) || n.width < 0 || n.width > 64) {
    E(
      e,
      "frame.frameStroke",
      "rejected value : width is outside the bounded range"
    );
    return;
  }
  if (n.align !== "INSIDE" && n.align !== "OUTSIDE" && n.align !== "CENTER") {
    E(e, "frame.frameStroke", "rejected value : align is not supported");
    return;
  }
  if (n.width !== 0)
    return { color: i, width: n.width, align: n.align };
}
function hi(t) {
  return t.align === "INSIDE" ? `inset 0 0 0 ${t.width}px ${t.color}` : `0 0 0 ${t.align === "CENTER" ? t.width / 2 : t.width}px ${t.color}`;
}
function Re(t) {
  if (typeof t == "number" && Number.isFinite(t) || typeof t == "string" && t.length > 0) return t;
}
function pe(t, e, n = "shadow.color") {
  if (!Array.isArray(t) || t.length === 0) return {};
  const i = [], r = [], o = [], s = [];
  for (const c of t) {
    if (typeof c != "object" || c === null) continue;
    const a = c, l = typeof a.color == "string" ? it(a.color) : null;
    if (l === null) {
      rt(n, e);
      continue;
    }
    const u = $t("shadowOffset", jt(a.x, 0)) ?? 0, f = $t("shadowOffset", jt(a.y, 0)) ?? 0, p = st("blur", jt(a.blur, 0)) ?? 0, m = $t("shadowSpread", jt(a.spread, 0)) ?? 0, h = a.inset === !0;
    if (!h && m === 0)
      i.push(`drop-shadow(${u}px ${f}px ${p / 2}px ${l})`);
    else {
      const k = `${h ? "inset " : ""}${u}px ${f}px ${p}px ${m}px ${l}`;
      if (r.push(k), !h) o.push(k);
      else {
        const v = tt(a.blendMode);
        s.push({
          color: l,
          x: u,
          y: f,
          blur: p,
          ...v === void 0 ? {} : { blendMode: v }
        });
      }
    }
  }
  return {
    ...i.length > 0 ? { filter: i.join(" ") } : {},
    ...r.length > 0 ? { boxShadow: r.join(", ") } : {},
    ...o.length > 0 ? { outerBoxShadow: o.join(", ") } : {},
    ...s.length > 0 ? { innerShadows: s } : {}
  };
}
function jt(t, e) {
  return typeof t == "number" && Number.isFinite(t) ? t : e;
}
const pi = 16 * 1024, mi = 4e3, gi = 64, yi = new Set("MmLlHhVvCcSsQqTtAaZz"), bi = 512, xi = 256 * 1024, gt = /* @__PURE__ */ new Map();
let Jt = 0;
function ki(t, e) {
  const n = (t.length + e.length) * 2;
  for (; gt.size >= bi || Jt + n > xi; ) {
    const i = gt.entries().next().value;
    if (i === void 0) return;
    gt.delete(i[0]), Jt -= i[1].weight;
  }
  gt.set(t, { value: e, weight: n }), Jt += n;
}
function Qt(t) {
  return t >= 48 && t <= 57;
}
function wi(t) {
  return t === 32 || t === 9 || t === 13 || t === 10 || t === 44;
}
function ae(t) {
  if (typeof t != "string" || t.length === 0 || t.length > pi) return null;
  const e = gt.get(t);
  if (e !== void 0)
    return gt.delete(t), gt.set(t, e), e.value;
  const n = t.trim();
  if (n.length === 0) return null;
  const i = n.toLowerCase();
  if (i.includes("url(") || i.includes("data:") || n.includes("<") || n.includes("&")) return null;
  const r = n.length;
  let o = 0, s = 0, c = !1;
  for (; o < r; ) {
    const a = n.charCodeAt(o);
    if (wi(a)) {
      o++;
      continue;
    }
    const l = n[o];
    if (yi.has(l)) {
      if (!c && l !== "M" && l !== "m" || (c = !0, s++, s > mi)) return null;
      o++;
      continue;
    }
    if (!c) return null;
    (l === "+" || l === "-") && o++;
    let u = 0;
    for (; o < r && Qt(n.charCodeAt(o)); )
      o++, u++;
    if (o < r && n[o] === ".") {
      o++;
      let f = 0;
      for (; o < r && Qt(n.charCodeAt(o)); )
        o++, f++;
      if (f === 0 && o < r && n[o] === ".") return null;
      u += f;
    }
    if (u === 0) return null;
    if (o < r && (n[o] === "e" || n[o] === "E")) {
      o++, o < r && (n[o] === "+" || n[o] === "-") && o++;
      let f = 0;
      for (; o < r && Qt(n.charCodeAt(o)); )
        o++, f++;
      if (f === 0) return null;
    }
  }
  return s === 0 ? null : (ki(t, n), n);
}
function vi(t) {
  let e = Number.POSITIVE_INFINITY, n = Number.NEGATIVE_INFINITY;
  for (const i of t) {
    const r = Mi(i.d);
    r !== null && (e = Math.min(e, r.minY), n = Math.max(n, r.maxY));
  }
  return Number.isFinite(e) && Number.isFinite(n) ? { minY: e, maxY: n } : null;
}
const Si = /[AaCcHhLlMmQqSsTtVvZz]|[-+]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][-+]?\d+)?/g, $i = {
  M: 2,
  L: 2,
  H: 1,
  V: 1,
  C: 6,
  S: 4,
  Q: 4,
  T: 2,
  A: 7
};
function Mi(t) {
  const e = t.match(Si);
  if (e === null) return null;
  let n = 0, i, r = 0, o = 0, s = Number.POSITIVE_INFINITY, c = Number.NEGATIVE_INFINITY;
  const a = (f) => {
    Number.isFinite(f) && (s = Math.min(s, f), c = Math.max(c, f));
  }, l = (f) => /^[A-Za-z]$/.test(f), u = () => {
    const f = e[n];
    if (f === void 0 || l(f)) return null;
    n += 1;
    const p = Number(f);
    return Number.isFinite(p) ? p : null;
  };
  for (; n < e.length; ) {
    const f = e[n];
    if (f !== void 0 && l(f)) {
      if (n += 1, f === "Z" || f === "z") {
        r = o, a(r), i = void 0;
        continue;
      }
      i = f;
    }
    if (i === void 0) return null;
    const p = i.toUpperCase(), m = $i[p];
    if (m === void 0) return null;
    const h = i === p;
    let k = p === "M", v = !1;
    for (; n < e.length && !l(e[n]); ) {
      const b = [];
      for (let g = 0; g < m; g += 1) {
        const $ = u();
        if ($ === null) return null;
        b.push($);
      }
      v = !0;
      const y = r;
      switch (p) {
        case "M":
        case "L":
        case "T": {
          r = h ? b[1] : y + b[1], a(r), p === "M" && k && (o = r, k = !1);
          break;
        }
        case "H":
          a(r);
          break;
        case "V":
          r = h ? b[0] : y + b[0], a(r);
          break;
        case "C": {
          const g = h ? b[1] : y + b[1], $ = h ? b[3] : y + b[3];
          r = h ? b[5] : y + b[5], a(g), a($), a(r);
          break;
        }
        case "S":
        case "Q": {
          const g = h ? b[1] : y + b[1];
          r = h ? b[3] : y + b[3], a(g), a(r);
          break;
        }
        case "A": {
          const g = Math.abs(b[1]);
          r = h ? b[6] : y + b[6], a(y - g), a(y + g), a(r - g), a(r + g);
          break;
        }
      }
      p === "M" && (i = h ? "L" : "l");
    }
    if (!v) return null;
  }
  return Number.isFinite(s) && Number.isFinite(c) ? { minY: s, maxY: c } : null;
}
function me(t, e) {
  const n = t.paths, i = t.pathData;
  if (Array.isArray(n)) {
    i !== void 0 && mt(e, "shape.pathData", "mutually exclusive with paths[] ; paths[] wins");
    const r = [];
    for (let o = 0; o < n.length; o++) {
      if (r.length >= gi) {
        mt(e, "shape.paths", "subpath cap exceeded ; remaining entries dropped");
        break;
      }
      const s = n[o], c = ae(
        typeof s == "object" && s !== null ? s.data : void 0
      );
      if (c === null) {
        mt(e, "shape.paths.data", "not a strict SVG path grammar (allowlist/caps)");
        continue;
      }
      r.push({ d: c, fillRule: Ai(s?.windingRule, e) });
    }
    return r.length === 0 && n.length > 0 && mt(e, "shape.paths", "no renderable subpath ; shape geometry omitted"), r;
  }
  if (i !== void 0) {
    const r = ae(i);
    return r === null ? (mt(e, "shape.pathData", "not a strict SVG path grammar (allowlist/caps)"), []) : [{ d: r, fillRule: "nonzero" }];
  }
  return mt(e, "shape.paths", "geometry is path but neither pathData nor paths[] is present"), [];
}
function Ai(t, e) {
  return t === void 0 || t === "NONZERO" ? "nonzero" : t === "EVENODD" ? "evenodd" : (mt(e, "shape.paths.windingRule", "unknown winding rule ; defaulting to nonzero"), "nonzero");
}
function mt(t, e, n) {
  E(t, e, n);
}
const Ri = /* @__PURE__ */ new Set(["none", "uppercase", "lowercase", "capitalize"]), Fi = /* @__PURE__ */ new Set(["none", "underline", "line-through"]), Ni = /* @__PURE__ */ new Set(["normal", "italic", "oblique"]), Ti = 1e3, Ei = 100, Fe = 1e3, Oi = 4096, _i = 64, Ne = 1e6, ji = /^[a-zA-Z0-9 ,.'"_-]{1,256}$/;
function yn(t) {
  if (typeof t != "string") return null;
  const e = t.trim();
  return e.length === 0 ? null : ji.test(e) ? e : null;
}
function Bi({
  resolved: t,
  nodeId: e,
  transitionFor: n,
  animateInitial: i,
  staticRender: r = !1
}) {
  const o = t.value === void 0 ? "" : String(t.value), s = o.replace(/[\u2028\u2029]/g, `
`), c = t.size ?? "1rem", a = t.weight ?? 400;
  let l;
  if (t.font !== void 0) {
    const M = yn(t.font);
    M === null ? E(e, "text.font", "rejected fontFamily : outside the family-list grammar") : l = M;
  }
  let u = "currentColor";
  if (t.colour !== void 0) {
    const M = it(t.colour);
    M === null ? rt("text.colour", e) : u = M;
  }
  const f = t.align ?? "start", p = t.textAutoResize, m = zt(t.width), h = zt(t.height), k = p === "WIDTH_AND_HEIGHT" ? "pre" : p === "NONE" || p === "HEIGHT" || p === "TRUNCATE" ? "pre-wrap" : void 0, v = Ui(t.opacity, 1), b = bn(t, e), y = Wi(t, f, e), g = pe(t.shadow, e, "text.shadow.color"), $ = Hi(t.textFills, e, {
    boxWidth: m,
    boxHeight: h
  }), T = typeof $.backgroundImage == "string", w = T ? null : zi(t.textOutline, o, e), x = g.outerBoxShadow, S = g.innerShadows === void 0 || g.innerShadows.length === 0 ? void 0 : Di(e, g.innerShadows), O = g.filter ?? "", z = Pi(s, t.textSegments, e), j = S !== void 0 && z === null && m !== void 0 && h !== void 0 ? /* @__PURE__ */ d(
    Ci,
    {
      id: `${S}-overlay`,
      value: s,
      width: m,
      height: h,
      shadows: g.innerShadows,
      style: {
        display: "inline-block",
        fontSize: c,
        ...l !== void 0 ? { fontFamily: l } : {},
        fontWeight: a,
        color: "white",
        width: m,
        height: h,
        ...k !== void 0 ? { whiteSpace: k } : {},
        textAlign: f,
        ...y,
        ...b,
        backgroundImage: "none",
        backgroundClip: "border-box",
        WebkitBackgroundClip: "border-box",
        WebkitTextFillColor: "white",
        filter: "none",
        boxShadow: "none",
        opacity: 1
      }
    }
  ) : null, D = Gt(n, ["opacity", "value"], i), P = Vt({ opacity: v }, i, e), X = r ? "svg" : xt.svg, R = r ? "span" : xt.span;
  return w !== null ? /* @__PURE__ */ C(et, { children: [
    S !== void 0 && /* @__PURE__ */ d(Te, { id: S, shadows: g.innerShadows }),
    /* @__PURE__ */ d(
      X,
      {
        width: w.size.w,
        height: w.size.h,
        viewBox: `0 0 ${w.size.w} ${w.size.h}`,
        role: "img",
        "aria-label": o,
        focusable: "false",
        style: {
          display: "block",
          ...r ? { opacity: v } : {},
          ...O !== "" ? { filter: O } : {},
          ...x !== void 0 ? { boxShadow: x } : {}
        },
        ...r ? {} : { initial: P.initial, animate: P.animate, transition: At(D) },
        children: w.paths.map((M, I) => /* @__PURE__ */ d("path", { d: M.data, fill: u, fillRule: M.fillRule }, I))
      }
    )
  ] }) : /* @__PURE__ */ C(et, { children: [
    S !== void 0 && /* @__PURE__ */ d(Te, { id: S, shadows: g.innerShadows }),
    /* @__PURE__ */ C(
      R,
      {
        style: {
          display: "inline-block",
          ...r ? { opacity: v } : {},
          fontSize: c,
          // `font` carries LSML text.style.fontFamily (spec'd in schema.json).
          // Omitted => inherit the host/container font.
          ...l !== void 0 ? { fontFamily: l } : {},
          fontWeight: a,
          color: T ? "transparent" : u,
          ...m !== void 0 ? { width: m } : {},
          ...h !== void 0 ? { height: h } : {},
          ...k !== void 0 ? { whiteSpace: k } : {},
          textAlign: f,
          ...y,
          ...T ? {
            ...$,
            backgroundClip: "text",
            WebkitBackgroundClip: "text",
            WebkitTextFillColor: "transparent"
          } : {},
          ...O !== "" ? { filter: O } : {},
          ...x !== void 0 ? { boxShadow: x } : {},
          ...b,
          ...j !== null ? { position: "relative" } : {}
        },
        ...r ? {} : { initial: P.initial, animate: P.animate, transition: At(D) },
        children: [
          z ?? s,
          j
        ]
      }
    )
  ] });
}
function Ci({
  id: t,
  value: e,
  width: n,
  height: i,
  shadows: r,
  style: o
}) {
  const s = Math.max(1, n, i), c = {
    ...o,
    position: "absolute",
    left: 0,
    top: 0
  };
  return /* @__PURE__ */ C(
    "svg",
    {
      "aria-hidden": "true",
      width: n,
      height: i,
      viewBox: `0 0 ${n} ${i}`,
      focusable: "false",
      style: {
        position: "absolute",
        inset: 0,
        width: n,
        height: i,
        overflow: "visible",
        pointerEvents: "none",
        zIndex: 1
      },
      children: [
        /* @__PURE__ */ d("defs", { children: /* @__PURE__ */ C(
          "filter",
          {
            id: t,
            x: -s,
            y: -s,
            width: n + s * 2,
            height: i + s * 2,
            filterUnits: "userSpaceOnUse",
            primitiveUnits: "userSpaceOnUse",
            colorInterpolationFilters: "sRGB",
            children: [
              r.map((a, l) => /* @__PURE__ */ C(dn, { children: [
                /* @__PURE__ */ d(
                  "feGaussianBlur",
                  {
                    in: "SourceAlpha",
                    stdDeviation: a.blur / 2,
                    result: `text-overlay-blur-${l}`
                  }
                ),
                /* @__PURE__ */ d(
                  "feOffset",
                  {
                    in: `text-overlay-blur-${l}`,
                    dx: a.x,
                    dy: a.y,
                    result: `text-overlay-offset-${l}`
                  }
                ),
                /* @__PURE__ */ d(
                  "feComposite",
                  {
                    in: "SourceAlpha",
                    in2: `text-overlay-offset-${l}`,
                    operator: "out",
                    result: `text-overlay-mask-${l}`
                  }
                ),
                /* @__PURE__ */ d("feFlood", { floodColor: a.color, result: `text-overlay-color-${l}` }),
                /* @__PURE__ */ d(
                  "feComposite",
                  {
                    in: `text-overlay-color-${l}`,
                    in2: `text-overlay-mask-${l}`,
                    operator: "in",
                    result: `text-overlay-paint-${l}`
                  }
                )
              ] }, l)),
              /* @__PURE__ */ d("feMerge", { children: r.map((a, l) => /* @__PURE__ */ d("feMergeNode", { in: `text-overlay-paint-${l}` }, l)) })
            ]
          }
        ) }),
        /* @__PURE__ */ d("g", { style: { filter: `url(#${t})` }, children: /* @__PURE__ */ d("foreignObject", { x: 0, y: 0, width: n, height: i, children: /* @__PURE__ */ d("span", { style: c, children: e }) }) })
      ]
    }
  );
}
function Pi(t, e, n) {
  if (!Array.isArray(e) || e.length === 0) return null;
  const i = [];
  let r = 0;
  for (let o = 0; o < e.length; o += 1) {
    const s = e[o];
    if (typeof s != "object" || s === null || Array.isArray(s))
      return E(n, "text.textSegments", "rejected malformed character-style segment"), null;
    const c = s, a = c.start, l = c.end;
    if (!Number.isInteger(a) || !Number.isInteger(l) || a < r || l <= a || l > t.length)
      return E(n, "text.textSegments", "rejected overlapping or out-of-bounds range"), null;
    a > r && i.push(t.slice(r, a));
    const u = t.slice(a, l);
    i.push(
      /* @__PURE__ */ d("span", { style: Li(c, n), children: u }, `text-segment-${o}`)
    ), r = l;
  }
  return r < t.length && i.push(t.slice(r)), i;
}
function Li(t, e) {
  const n = {}, i = t.fontName;
  if (typeof i == "object" && i !== null && !Array.isArray(i)) {
    const o = i, s = yn(o.family);
    if (s !== null && (n.fontFamily = s), typeof o.style == "string") {
      const c = Ii(o.style);
      c !== void 0 && (n.fontWeight = c), /italic/i.test(o.style) ? n.fontStyle = "italic" : /oblique/i.test(o.style) && (n.fontStyle = "oblique");
    }
  }
  if (zt(t.fontWeight) && (n.fontWeight = t.fontWeight), zt(t.fontSize) && (n.fontSize = t.fontSize), t.textFills !== void 0) {
    const o = Dt(
      Ot(t.textFills, "text.textSegments.textFills", e),
      "text.textSegments.textFills",
      e
    ), s = Xt(o, e);
    typeof s.backgroundImage == "string" && Object.assign(n, s, {
      color: "transparent",
      backgroundClip: "text",
      WebkitBackgroundClip: "text",
      WebkitTextFillColor: "transparent"
    });
  }
  const r = bn(
    {
      lineHeight: t.lineHeight,
      letterSpacing: t.letterSpacing,
      textTransform: t.textTransform,
      textDecoration: t.textDecoration,
      fontStyle: t.fontStyle
    },
    e
  );
  return Object.assign(n, r), n;
}
function Ii(t) {
  const e = t.toLowerCase().replace(/[\s_-]+/g, "");
  if (e.includes("thin") || e.includes("hairline")) return 100;
  if (e.includes("extralight") || e.includes("ultralight")) return 200;
  if (e.includes("light")) return 300;
  if (e.includes("semibold") || e.includes("demibold")) return 600;
  if (e.includes("extrabold") || e.includes("ultrabold")) return 800;
  if (e.includes("black") || e.includes("heavy")) return 900;
  if (e.includes("bold")) return 700;
  if (e.includes("medium")) return 500;
  if (e.includes("regular") || e.includes("book") || e === "normal")
    return 400;
}
function Te({ id: t, shadows: e }) {
  return /* @__PURE__ */ d(
    "svg",
    {
      "aria-hidden": "true",
      width: "0",
      height: "0",
      style: { position: "absolute", width: 0, height: 0, overflow: "hidden" },
      children: /* @__PURE__ */ d("defs", { children: /* @__PURE__ */ C(
        "filter",
        {
          id: t,
          x: "-1",
          y: "-1",
          width: "3",
          height: "3",
          filterUnits: "objectBoundingBox",
          colorInterpolationFilters: "sRGB",
          children: [
            e.map((n, i) => /* @__PURE__ */ C(dn, { children: [
              /* @__PURE__ */ d(
                "feGaussianBlur",
                {
                  in: "SourceAlpha",
                  stdDeviation: n.blur / 2,
                  result: `text-shadow-blur-${i}`
                }
              ),
              /* @__PURE__ */ d(
                "feOffset",
                {
                  in: `text-shadow-blur-${i}`,
                  dx: n.x,
                  dy: n.y,
                  result: `text-shadow-offset-${i}`
                }
              ),
              /* @__PURE__ */ d(
                "feComposite",
                {
                  in: "SourceAlpha",
                  in2: `text-shadow-offset-${i}`,
                  operator: "out",
                  result: `text-shadow-diff-${i}`
                }
              ),
              /* @__PURE__ */ d("feFlood", { floodColor: n.color, result: `text-shadow-color-${i}` }),
              /* @__PURE__ */ d(
                "feComposite",
                {
                  in: `text-shadow-color-${i}`,
                  in2: `text-shadow-diff-${i}`,
                  operator: "in",
                  result: `text-shadow-inner-${i}`
                }
              )
            ] }, i)),
            /* @__PURE__ */ C("feMerge", { children: [
              e.map((n, i) => /* @__PURE__ */ d("feMergeNode", { in: `text-shadow-inner-${i}` }, `shadow-${i}`)),
              /* @__PURE__ */ d("feMergeNode", { in: "SourceGraphic" })
            ] })
          ]
        }
      ) })
    }
  );
}
function Di(t, e) {
  const n = `${t ?? "anonymous"}:${JSON.stringify(e)}`;
  let i = 2166136261;
  for (let o = 0; o < n.length; o += 1)
    i ^= n.charCodeAt(o), i = Math.imul(i, 16777619);
  return `lumencast-text-inner-${(t ?? "anonymous").replace(/[^a-zA-Z0-9_-]/g, "-")}-${(i >>> 0).toString(16)}`;
}
function zi(t, e, n) {
  if (typeof t != "object" || t === null || Array.isArray(t)) return null;
  const i = t;
  if (typeof i.characters != "string" || i.characters.length > Oi)
    return E(n, "text.textOutline.characters", "rejected static glyph outline text"), null;
  if (i.characters !== e) return null;
  if (typeof i.size != "object" || i.size === null || Array.isArray(i.size))
    return E(n, "text.textOutline.size", "rejected static glyph outline dimensions"), null;
  const r = i.size;
  if (!Ee(r.w, Ne) || !Ee(r.h, Ne) || r.w <= 0 || r.h <= 0)
    return E(n, "text.textOutline.size", "rejected static glyph outline dimensions"), null;
  if (!Array.isArray(i.paths) || i.paths.length === 0)
    return E(n, "text.textOutline.paths", "rejected empty static glyph outline"), null;
  if (i.paths.length > _i)
    return E(n, "text.textOutline.paths", "rejected oversized static glyph outline"), null;
  const o = [];
  for (let s = 0; s < i.paths.length; s++) {
    const c = i.paths[s];
    if (typeof c != "object" || c === null || Array.isArray(c))
      return E(n, `text.textOutline.paths[${s}]`, "rejected malformed glyph path"), null;
    const a = c, l = ae(a.data);
    if (l === null)
      return E(
        n,
        `text.textOutline.paths[${s}].data`,
        "rejected invalid glyph path"
      ), null;
    const u = a.windingRule === void 0 || a.windingRule === "NONZERO" ? "nonzero" : a.windingRule === "EVENODD" ? "evenodd" : null;
    if (u === null)
      return E(
        n,
        `text.textOutline.paths[${s}].windingRule`,
        "rejected invalid glyph winding rule"
      ), null;
    o.push({ data: l, fillRule: u });
  }
  return { characters: i.characters, size: { w: r.w, h: r.h }, paths: o };
}
function Ee(t, e) {
  return typeof t == "number" && Number.isFinite(t) && Math.abs(t) <= e;
}
function Ui(t, e) {
  return typeof t == "number" && Number.isFinite(t) ? t : e;
}
function zt(t) {
  return typeof t == "number" && Number.isFinite(t) && t > 0 ? t : void 0;
}
function Hi(t, e, n = {}) {
  const r = Ot(t, "text.textFills", e).filter((o) => o.kind !== "image" ? !0 : (E(
    e,
    "text.textFills.kind",
    "image fills are not supported for text paint arrays; layer dropped"
  ), !1));
  return Xt(Dt(r, "text.textFills", e), e, n);
}
function Wi(t, e, n) {
  const i = t.textAlignVertical;
  if (i === void 0) return {};
  if (i !== "TOP" && i !== "CENTER" && i !== "BOTTOM")
    return E(
      n,
      "text.textAlignVertical",
      "rejected vertical alignment : expected TOP, CENTER, or BOTTOM"
    ), {};
  const r = t.height;
  if (typeof r != "number" || !Number.isFinite(r) || r <= 0) return {};
  const o = t.width, s = e === "center" ? "center" : e === "end" || e === "right" ? "flex-end" : "flex-start";
  return {
    display: "flex",
    // Preserve Figma's fixed-box baseline rounding for fractional heights.
    position: "relative",
    top: "1px",
    // The text primitive can sit directly in an auto-layout frame. In that
    // case there is no sized universal wrapper to provide the containing box;
    // `100%` would resolve against the parent frame (the footer headings were
    // expanding to 236px instead of their authored 30px box). Keep the exact
    // Figma dimensions on the leaf. For an absolutely placed text node these
    // dimensions equal the wrapper's box, so the same rule covers both paths.
    ...typeof o == "number" && Number.isFinite(o) && o > 0 ? { width: o } : {},
    height: r,
    alignItems: i === "CENTER" ? "center" : i === "BOTTOM" ? "flex-end" : "flex-start",
    justifyContent: s
  };
}
function bn(t, e) {
  const n = Oe(
    t.lineHeight,
    0,
    Ei,
    "text.lineHeight",
    e
  ), i = Oe(
    t.letterSpacing,
    -Fe,
    Fe,
    "text.letterSpacing",
    e
  ), r = te(
    t.textTransform,
    Ri,
    "text.textTransform",
    e
  ), o = te(
    t.textDecoration,
    Fi,
    "text.textDecoration",
    e
  ), s = te(t.fontStyle, Ni, "text.fontStyle", e), c = Yi(t.maxLines, Ti, "text.maxLines", e);
  return {
    ...n !== void 0 ? { lineHeight: n } : {},
    // Built from a validated finite number — no string passthrough.
    ...i !== void 0 ? { letterSpacing: `${i}px` } : {},
    ...r !== void 0 ? { textTransform: r } : {},
    ...o !== void 0 ? { textDecoration: o } : {},
    ...s !== void 0 ? { fontStyle: s } : {},
    ...c !== void 0 ? {
      display: "-webkit-box",
      WebkitBoxOrient: "vertical",
      WebkitLineClamp: c,
      overflow: "hidden",
      textOverflow: "ellipsis"
    } : {}
  };
}
function te(t, e, n, i) {
  if (t !== void 0) {
    if (typeof t == "string" && e.has(t)) return t;
    ge(n, i);
  }
}
function Oe(t, e, n, i, r) {
  if (t !== void 0) {
    if (typeof t == "number" && Number.isFinite(t) && t >= e && t <= n) return t;
    ge(i, r);
  }
}
function Yi(t, e, n, i) {
  if (t !== void 0) {
    if (typeof t == "number" && Number.isInteger(t) && t >= 1 && t <= e) return t;
    ge(n, i);
  }
}
function ge(t, e) {
  E(
    e,
    t,
    "rejected typography value : outside the field's spec'd grammar or caps"
  );
}
const Gi = [
  "exposure",
  "contrast",
  "saturation",
  "temperature",
  "tint",
  "highlights",
  "shadows"
];
function Vi(t, e) {
  if (t === void 0) return;
  if (typeof t != "object" || t === null || Array.isArray(t)) {
    E(
      e,
      "image.imageFilters",
      "rejected value : expected a bounded channel object"
    );
    return;
  }
  const n = t, i = {};
  for (const r of Gi) {
    const o = n[r];
    if (o !== void 0) {
      if (typeof o != "number" || !Number.isFinite(o)) {
        qi(r, e);
        continue;
      }
      i[r] = Math.max(-1, Math.min(1, o));
    }
  }
  return Object.keys(i).length > 0 ? i : void 0;
}
function Xi(t) {
  if (!t) return;
  const e = [], n = t.exposure ?? 0;
  n !== 0 && e.push(`brightness(${ct(2 ** n)})`);
  const i = t.tint ?? 0;
  if (i !== 0) {
    const l = 1 - 0.9 * Math.max(i, 0) + 0.2 * Math.min(i, 0), u = 1 - 0.5 * Math.abs(i);
    e.push(`brightness(${ct(Math.max(0.1, l))})`), e.push(`saturate(${ct(Math.max(0, u))})`);
  }
  const r = t.contrast ?? 0;
  r !== 0 && e.push(`contrast(${ct(Math.max(0, 1 + r))})`);
  const o = t.saturation ?? 0;
  o !== 0 && e.push(`saturate(${ct(Math.max(0, 1 + o))})`);
  const s = t.temperature ?? 0;
  s !== 0 && (e.push(`sepia(${ct(0.25 * Math.abs(s))})`), e.push(`hue-rotate(${ct(-30 * s)}deg)`));
  const c = t.highlights ?? 0;
  c !== 0 && e.push(`contrast(${ct(Math.max(0, 1 - 0.2 * c))})`);
  const a = t.shadows ?? 0;
  return a !== 0 && e.push(`brightness(${ct(Math.max(0.1, 1 + 0.25 * a))})`), e.length > 0 ? e.join(" ") : void 0;
}
function ct(t) {
  return Number(t.toFixed(4)).toString();
}
function qi(t, e) {
  E(
    e,
    `image.imageFilters.${t}`,
    "rejected value : expected a finite channel in the interval [-1, 1]"
  );
}
const St = /* @__PURE__ */ new Map();
function Ki(t, e) {
  let n = St.get(t);
  if (n === void 0) {
    let s, c;
    const l = { promise: new Promise((u, f) => {
      s = u, c = f;
    }), references: 0, settled: !1 };
    n = l, St.set(t, l), Promise.resolve().then(e).then(
      (u) => {
        l.raster = u, l.settled = !0, _e(t, l), s(u);
      },
      (u) => {
        l.settled = !0, St.get(t) === l && St.delete(t), c(u);
      }
    );
  }
  n.references += 1;
  let i = !1;
  const r = () => {
    i || (i = !0, n.references -= 1, _e(t, n));
  };
  return { promise: n.promise.then((s) => ({
    src: s.src,
    ...s.fallbackToDataUrl !== void 0 ? { fallbackToDataUrl: s.fallbackToDataUrl } : {},
    release: r
  })), release: r };
}
function _e(t, e) {
  if (!e.settled || e.references !== 0) return;
  St.get(t) === e && St.delete(t);
  const n = e.raster;
  e.raster = void 0;
  try {
    n?.release?.();
  } catch {
  }
}
const Zi = new Uint8Array(new Uint32Array([1]).buffer)[0] === 1, ot = 16711935, je = 131074;
function Be(t, e) {
  try {
    const n = new URL(e), i = new URL(t, n);
    return (i.protocol === "http:" || i.protocol === "https:") && i.origin === n.origin;
  } catch {
    return !1;
  }
}
async function Ce(t) {
  if (typeof t.toBlob != "function" || typeof URL.createObjectURL != "function")
    return { src: t.toDataURL("image/png") };
  let e;
  try {
    e = await new Promise((r) => t.toBlob(r, "image/png"));
  } catch {
    e = null;
  }
  if (e === null) return { src: t.toDataURL("image/png") };
  let n;
  try {
    n = URL.createObjectURL(e);
  } catch {
    return { src: t.toDataURL("image/png") };
  }
  let i = !1;
  return {
    src: n,
    release: () => {
      i || (i = !0, URL.revokeObjectURL(n));
    },
    // Some embedding pages allow `data:` but not `blob:` in img-src. If the
    // generated URL is blocked, preserve the existing exact-render fallback.
    fallbackToDataUrl: () => t.toDataURL("image/png")
  };
}
function Ji(t, e, n, i) {
  const r = e / 2, o = n / 2;
  if (!Number.isSafeInteger(e) || !Number.isSafeInteger(n) || e <= 0 || n <= 0 || e % 2 !== 0 || n % 2 !== 0 || t.length !== e * n * 4 || i.length !== r * o * 4)
    throw new RangeError("2×2 image reduction requires matching even-sized RGBA buffers");
  const s = t.byteOffset + t.byteLength, c = i.byteOffset + i.byteLength, a = t.buffer === i.buffer && t.byteOffset < c && i.byteOffset < s;
  if (Zi && t.byteOffset % 4 === 0 && i.byteOffset % 4 === 0 && !a) {
    const f = new Uint32Array(t.buffer, t.byteOffset, t.length / 4), p = new Uint32Array(i.buffer, i.byteOffset, i.length / 4);
    for (let m = 0; m < o; m += 1) {
      const h = m * e * 2, k = h + e, v = m * r;
      for (let b = 0; b < r; b += 1) {
        const y = h + b * 2, g = f[y], $ = f[y + 1], T = f[k + b * 2], w = f[k + b * 2 + 1], x = (g & ot) + ($ & ot) + (T & ot) + (w & ot) + je >> 2, S = (g >>> 8 & ot) + ($ >>> 8 & ot) + (T >>> 8 & ot) + (w >>> 8 & ot) + je >> 2;
        p[v + b] = (x & ot | (S & ot) << 8) >>> 0;
      }
    }
    return;
  }
  const l = e * 4, u = r * 4;
  for (let f = 0; f < o; f += 1) {
    let p = f * l * 2, m = f * u;
    const h = p + l;
    for (let k = 0; k < r; k += 1) {
      const v = h + k * 8;
      i[m] = t[p] + t[p + 4] + t[v] + t[v + 4] + 2 >> 2, i[m + 1] = t[p + 1] + t[p + 5] + t[v + 1] + t[v + 5] + 2 >> 2, i[m + 2] = t[p + 2] + t[p + 6] + t[v + 2] + t[v + 6] + 2 >> 2, i[m + 3] = t[p + 3] + t[p + 7] + t[v + 3] + t[v + 7] + 2 >> 2, p += 8, m += 4;
    }
  }
}
function Qi({
  resolved: t,
  nodeId: e,
  transitionFor: n,
  animateInitial: i,
  staticRender: r = !1
}) {
  const o = Tt(), s = Et(), c = Yt(t.src, o, "image.src", e, s), a = er(t.imageScaleFactor, e), l = kt(null), [u, f] = Wt(void 0), p = u && u.input === c && u.factor === a ? u : void 0;
  if (ht(() => {
    let j = !1, D, P;
    if (!c || a === 1)
      return f(void 0), () => {
        j = !0;
      };
    f(void 0);
    const X = (N) => {
      if (j) return;
      const U = Math.max(1, Math.round(N.naturalWidth * a)), Z = Math.max(1, Math.round(N.naturalHeight * a)), L = JSON.stringify([c, a]) ?? "", G = Ki(
        L,
        () => tr(N, a, U, Z)
      );
      D = G.release, G.promise.then((B) => {
        if (j) {
          B.release?.();
          return;
        }
        f({ ...B, input: c, factor: a });
      }).catch(() => {
      });
    }, R = () => {
      const N = new window.Image();
      return P = N, N.decoding = "async", N.crossOrigin = "anonymous", N.onload = () => X(N), N.src = c, N;
    }, M = l.current;
    if (M && Be(c, window.location.origin)) {
      const N = () => {
        if (!(j || M.getAttribute("src") !== c)) {
          if (!Be(M.currentSrc, window.location.origin)) {
            R();
            return;
          }
          X(M);
        }
      };
      return M.complete ? M.naturalWidth > 0 && N() : M.addEventListener("load", N, { once: !0 }), () => {
        j = !0, M.removeEventListener("load", N), P && (P.onload = null, P.onerror = null), D?.();
      };
    }
    const I = R();
    return () => {
      j = !0, I.onload = null, I.onerror = null, D?.();
    };
  }, [c, a]), !c) return null;
  const m = typeof t.alt == "string" ? t.alt : "", h = t.fit ?? "contain", k = t.position ?? "center", v = nr(t.opacity, 1), b = Pe(t.width, "100%"), y = Pe(t.height, "100%"), g = ir(t.imageTransform, e, b, y), $ = pe(t.shadow, e, "image.shadow.color"), w = [Xi(Vi(t.imageFilters, e)), $.filter].filter((j) => j !== void 0).join(" "), x = Gt(n, ["opacity", "src"], i), S = Vt({ opacity: v }, i, e), O = r ? "img" : xt.img, z = /* @__PURE__ */ d(
    O,
    {
      ref: l,
      src: p?.src ?? c,
      alt: m,
      style: {
        objectFit: h,
        objectPosition: k,
        // Keep static image opacity in the DOM style as well as in Framer's
        // animation target. `motion.img` does not necessarily materialize an
        // unchanged target value, so omitting this would make authored image
        // paint opacity silently render as 1.
        opacity: v,
        width: g?.width ?? b,
        height: g?.height ?? y,
        ...g ? {
          position: "absolute",
          left: g.left,
          top: g.top,
          ...g.css ? { transformOrigin: "0 0", transform: g.css } : {},
          ...g.axisAligned || g.transformedObjectFitFill ? { objectFit: "fill" } : {}
        } : {},
        ...w !== "" ? { filter: w } : {},
        ...$.boxShadow !== void 0 ? { boxShadow: $.boxShadow } : {}
        // NB: NO `will-change` here. Promoting the <img> to its own GPU layer
        // hoists it out of the wrapper's paint buffer, so a `mix-blend-mode`
        // on the wrapper (Sunshine screen, Ruby20 / caramel hard-light) blends
        // an EMPTY box with the backdrop → the blend silently no-ops and the
        // image's contribution (the diagonal light streaks, the warm Ruby) is
        // lost. Static images don't need the compositor hint anyway.
      },
      ...r ? {} : { initial: S.initial, animate: S.animate, transition: At(x) },
      onLoad: () => {
        p?.fallbackToDataUrl && f({ ...p, fallbackToDataUrl: void 0 });
      },
      onError: () => {
        const j = p?.fallbackToDataUrl;
        if (!(!j || !p))
          try {
            const D = j();
            p.release?.(), f({
              ...p,
              src: D,
              release: void 0,
              fallbackToDataUrl: void 0
            });
          } catch {
            f(void 0);
          }
      },
      draggable: !1
    }
  );
  return g ? /* @__PURE__ */ d("div", { style: { position: "relative", overflow: "hidden", width: b, height: y }, children: z }) : z;
}
async function tr(t, e, n, i) {
  if (e === 0.5 && t.naturalWidth % 2 === 0 && t.naturalHeight % 2 === 0) {
    const c = document.createElement("canvas");
    c.width = t.naturalWidth, c.height = t.naturalHeight;
    const a = c.getContext("2d", { willReadFrequently: !0 });
    if (!a) throw new Error("image source canvas unavailable");
    a.drawImage(t, 0, 0, t.naturalWidth, t.naturalHeight);
    const l = a.getImageData(
      0,
      0,
      t.naturalWidth,
      t.naturalHeight
    );
    c.width = n, c.height = i;
    const u = c.getContext("2d");
    if (!u) throw new Error("image target canvas unavailable");
    const f = u.createImageData(n, i);
    return Ji(
      l.data,
      t.naturalWidth,
      t.naturalHeight,
      f.data
    ), u.putImageData(f, 0, 0), Ce(c);
  }
  const o = document.createElement("canvas");
  o.width = n, o.height = i;
  const s = o.getContext("2d");
  if (!s) throw new Error("image canvas unavailable");
  return s.imageSmoothingEnabled = !0, s.imageSmoothingQuality = "low", s.drawImage(t, 0, 0, n, i), Ce(o);
}
function er(t, e) {
  return t === void 0 ? 1 : typeof t != "number" || !Number.isFinite(t) || t <= 0 || t > 1 ? (E(
    e,
    "image.imageScaleFactor",
    "rejected value : expected a finite number in the interval (0, 1]"
  ), 1) : t;
}
function nr(t, e) {
  return typeof t == "number" && Number.isFinite(t) ? t : e;
}
function Pe(t, e) {
  return typeof t == "number" && Number.isFinite(t) ? `${t}px` : typeof t == "string" && t.length > 0 ? t : e;
}
function ir(t, e, n, i) {
  if (!Array.isArray(t) || t.length !== 6) return;
  if (t.some(
    (k) => typeof k != "number" || !Number.isFinite(k) || Math.abs(k) > 1e3
  )) {
    E(e, "image.imageTransform", "rejected value : not a finite bounded matrix");
    return;
  }
  const [r, o, s, c, a, l] = t, u = Le(n), f = Le(i);
  if (Math.abs(o) < 1e-6 && Math.abs(s) < 1e-6 && r > 0 && c > 0 && u !== void 0 && f !== void 0)
    return {
      axisAligned: !0,
      width: `${u / r}px`,
      height: `${f / c}px`,
      // The Figma translation describes which source region is exposed by
      // the node. CSS positions the larger source image in the opposite
      // direction inside the clipped node box.
      left: `${-(u / r) * a}px`,
      top: `${-(f / c) * l}px`
    };
  const m = u === void 0 ? 0 : a * u, h = f === void 0 ? 0 : l * f;
  if (u !== void 0 && f !== void 0) {
    const k = r * c - o * s, v = Math.max(Math.abs(r), 1e-6), b = Math.max(Math.abs(c), 1e-6);
    if (Math.abs(k) > 1e-6) {
      const y = u / v, g = f / b, $ = c / k, T = -o / k, w = -s / k, x = r / k, S = -($ * a + w * l), O = -(T * a + x * l);
      return {
        width: `${y}px`,
        height: `${g}px`,
        left: 0,
        top: 0,
        transformedObjectFitFill: !0,
        css: `matrix(${u / y * $},${f / y * T},${u / g * w},${f / g * x},${u * S},${f * O})`
      };
    }
  }
  return {
    css: `matrix(${r},${o},${s},${c},${m},${h})`,
    left: 0,
    top: 0,
    width: "100%",
    height: "100%"
  };
}
function Le(t) {
  if (!t) return;
  const e = /^(-?\d+(?:\.\d+)?)px$/.exec(t);
  return e ? Number(e[1]) : void 0;
}
function xn(t) {
  return t.geometry ?? t.kind ?? "rect";
}
function q(t, e) {
  return typeof t == "number" && Number.isFinite(t) ? t : e;
}
function rr(t) {
  if (typeof t != "object" || t === null || Array.isArray(t)) return null;
  const e = t, n = [
    e.topLeft,
    e.topRight,
    e.bottomRight,
    e.bottomLeft
  ];
  return n.every((i) => typeof i == "number" && Number.isFinite(i) && i >= 0) ? {
    topLeft: n[0],
    topRight: n[1],
    bottomRight: n[2],
    bottomLeft: n[3]
  } : null;
}
function or(t, e, n) {
  const i = Math.min(t, e) / 2, r = {
    topLeft: Math.min(n.topLeft, i),
    topRight: Math.min(n.topRight, i),
    bottomRight: Math.min(n.bottomRight, i),
    bottomLeft: Math.min(n.bottomLeft, i)
  }, o = [
    r.topLeft + r.topRight,
    r.bottomLeft + r.bottomRight,
    r.topLeft + r.bottomLeft,
    r.topRight + r.bottomRight
  ], s = Math.min(
    1,
    ...o.map((c, a) => c <= 0 ? 1 : (a < 2 ? t : e) / c)
  );
  return {
    topLeft: r.topLeft * s,
    topRight: r.topRight * s,
    bottomRight: r.bottomRight * s,
    bottomLeft: r.bottomLeft * s
  };
}
function Ie(t, e, n, i, r) {
  const o = t + n, s = e + i, c = r.topRight > 0 ? `A ${r.topRight} ${r.topRight} 0 0 1 ${o} ${e + r.topRight}` : `L ${o} ${e}`, a = r.bottomRight > 0 ? `A ${r.bottomRight} ${r.bottomRight} 0 0 1 ${o - r.bottomRight} ${s}` : `L ${o} ${s}`, l = r.bottomLeft > 0 ? `A ${r.bottomLeft} ${r.bottomLeft} 0 0 1 ${t} ${s - r.bottomLeft}` : `L ${t} ${s}`, u = r.topLeft > 0 ? `A ${r.topLeft} ${r.topLeft} 0 0 1 ${t + r.topLeft} ${e}` : `L ${t} ${e}`;
  return [
    `M ${t + r.topLeft} ${e}`,
    `H ${o - r.topRight}`,
    c,
    `V ${s - r.bottomRight}`,
    a,
    `H ${t + r.bottomLeft}`,
    l,
    `V ${e + r.topLeft}`,
    u,
    "Z"
  ].join(" ");
}
function vt(t, e, n, i = "geom") {
  const r = xn(t), o = q(t.width, 100), s = q(t.height, 100), c = q(t.radius, 0), a = e.stroke ?? "none", l = e.strokeWidth ?? 0, u = e.strokeAlign ?? "CENTER", f = Math.max(0, o - l), p = Math.max(0, s - l), m = Math.min(
    Math.max(0, c - l / 2),
    f / 2,
    p / 2
  ), h = c > Math.min(o, s) / 2, k = r === "path" && s === 0 && a !== "none" && (e.fill === "none" || e.fill === "transparent") ? a : e.fill, v = k === a && e.fill !== a ? "none" : a, b = e.mixBlendMode !== void 0 || e.filter !== void 0 ? {
    ...e.mixBlendMode === void 0 ? {} : { mixBlendMode: e.mixBlendMode },
    ...e.filter === void 0 ? {} : { filter: e.filter }
  } : void 0;
  if (r === "path") {
    const $ = me(t, n), T = a !== "none" && l > 0 ? De(t, n) : [], w = T.length > 0, x = a !== "none" && l > 0 && u === "INSIDE" ? ze(
      n,
      i,
      `path:${o}:${s}:${$.map((S) => `${S.d}:${S.fillRule}`).join("|")}`
    ) : void 0;
    return /* @__PURE__ */ C("g", { style: b, children: [
      x !== void 0 && /* @__PURE__ */ d("defs", { children: /* @__PURE__ */ d("clipPath", { id: x, children: $.map((S, O) => /* @__PURE__ */ d("path", { d: S.d, fill: "white", fillRule: S.fillRule }, O)) }) }),
      w ? /* @__PURE__ */ C(et, { children: [
        e.fill !== "none" && $.map((S, O) => /* @__PURE__ */ d("path", { d: S.d, fillRule: S.fillRule, fill: e.fill }, `fill-${O}`)),
        T.map((S, O) => /* @__PURE__ */ d(
          "path",
          {
            d: S.d,
            fillRule: S.fillRule,
            fill: a,
            ...x !== void 0 ? { clipPath: `url(#${x})` } : {}
          },
          `stroke-outline-${O}`
        ))
      ] }) : $.map((S, O) => /* @__PURE__ */ d(
        "path",
        {
          d: S.d,
          fillRule: S.fillRule,
          fill: k,
          stroke: v,
          strokeWidth: v === "none" ? 0 : x !== void 0 ? l * 2 : l,
          ...x !== void 0 ? { clipPath: `url(#${x})` } : {}
        },
        O
      ))
    ] }, i);
  }
  if (r === "circle") {
    const $ = a !== "none" && l > 0 ? De(t, n) : [];
    if ($.length > 0) {
      const x = u === "INSIDE" ? ze(n, i, `circle:${o}:${s}`) : void 0;
      return /* @__PURE__ */ C("g", { style: b, children: [
        x !== void 0 && /* @__PURE__ */ d("defs", { children: /* @__PURE__ */ d("clipPath", { id: x, children: /* @__PURE__ */ d(
          "ellipse",
          {
            cx: o / 2,
            cy: s / 2,
            rx: o / 2,
            ry: s / 2,
            fill: "white"
          }
        ) }) }),
        $.map((S, O) => /* @__PURE__ */ d(
          "path",
          {
            d: S.d,
            fillRule: S.fillRule,
            fill: a,
            ...x !== void 0 ? { clipPath: `url(#${x})` } : {}
          },
          `stroke-outline-${O}`
        ))
      ] }, i);
    }
    const T = u === "INSIDE" ? o / 2 - l / 2 : u === "OUTSIDE" ? o / 2 + l / 2 : o / 2, w = u === "INSIDE" ? s / 2 - l / 2 : u === "OUTSIDE" ? s / 2 + l / 2 : s / 2;
    return /* @__PURE__ */ d(
      "ellipse",
      {
        style: b,
        cx: o / 2,
        cy: s / 2,
        rx: Math.max(0, T),
        ry: Math.max(0, w),
        fill: e.fill,
        stroke: a,
        strokeWidth: l
      },
      i
    );
  }
  if (r === "line")
    return /* @__PURE__ */ d(
      "line",
      {
        style: b,
        x1: "0",
        y1: s / 2,
        x2: o,
        y2: s / 2,
        stroke: a !== "none" ? a : e.fill,
        strokeWidth: l || 1
      },
      i
    );
  const y = l / 2, g = rr(t.cornerRadii);
  if (g) {
    const $ = l / 2, T = Math.max(0, o - l), w = Math.max(0, s - l), x = or(T, w, {
      topLeft: Math.max(0, g.topLeft - $),
      topRight: Math.max(0, g.topRight - $),
      bottomRight: Math.max(0, g.bottomRight - $),
      bottomLeft: Math.max(0, g.bottomLeft - $)
    });
    return /* @__PURE__ */ d(
      "path",
      {
        style: b,
        d: Ie($, $, T, w, x),
        fill: e.fill,
        stroke: a,
        strokeWidth: l
      },
      i
    );
  }
  return h ? /* @__PURE__ */ d(
    "path",
    {
      style: b,
      d: Ie(y, y, f, p, {
        topLeft: m,
        topRight: m,
        bottomRight: m,
        bottomLeft: m
      }),
      fill: e.fill,
      stroke: a,
      strokeWidth: l
    },
    i
  ) : /* @__PURE__ */ d(
    "rect",
    {
      style: b,
      x: l / 2,
      y: l / 2,
      width: f,
      height: p,
      rx: m,
      ry: m,
      fill: e.fill,
      stroke: a,
      strokeWidth: l
    },
    i
  );
}
function De(t, e) {
  const n = t.stroke_geometry;
  return Array.isArray(n) ? me({ paths: n }, e) : [];
}
function ze(t, e, n) {
  const i = `${t ?? "anonymous"}:${e}:${n}`;
  let r = 2166136261;
  for (let o = 0; o < i.length; o += 1)
    r ^= i.charCodeAt(o), r = Math.imul(r, 16777619);
  return `lumen-stroke-inside-${(r >>> 0).toString(16)}`;
}
function sr(t, e, n) {
  if (t.kind !== "shape") return null;
  const i = t.props ?? {}, r = wn(
    i,
    e,
    "mask-cover",
    ar(t, n)
  );
  return kn(r, i, "mask-cover");
}
function kn(t, e, n) {
  let i = 1;
  for (const r of ["opacity", "universal_opacity"]) {
    const o = e[r];
    typeof o == "number" && Number.isFinite(o) && (i *= Math.min(1, Math.max(0, o)));
  }
  return i === 1 ? t : /* @__PURE__ */ d("g", { opacity: i, children: t }, `${n}-opacity`);
}
function wn(t, e, n, i = !1) {
  const [r] = Ot(t.fills, "mask.source.fills", e), o = t.stroke, s = typeof o == "string" ? o : typeof o == "object" && o !== null && typeof o.color == "string" ? o.color : void 0, c = typeof t.stroke_width == "number" && Number.isFinite(t.stroke_width) ? t.stroke_width : typeof o == "object" && o !== null && typeof o.width == "number" && Number.isFinite(o.width) ? o.width : void 0, a = t.stroke_align === "INSIDE" || t.stroke_align === "OUTSIDE" || t.stroke_align === "CENTER" ? t.stroke_align : typeof o == "object" && o !== null && (o.align === "INSIDE" || o.align === "OUTSIDE" || o.align === "CENTER") ? o.align : void 0, l = s !== void 0 ? { stroke: s, strokeWidth: c, strokeAlign: a } : {};
  if (i && s !== void 0)
    return vt(t, { fill: "white" }, e, n);
  if (r !== void 0 && r.kind !== "image") {
    const f = Lt(r);
    return /* @__PURE__ */ C("g", { children: [
      f.defs.length > 0 && /* @__PURE__ */ d("defs", { children: f.defs }),
      vt(t, { fill: f.ref, ...l }, e, n)
    ] }, `${n}-painted`);
  }
  const u = typeof t.fill == "string" ? t.fill : void 0;
  return u !== void 0 ? vt(t, { fill: u, ...l }, e, n) : s !== void 0 ? vt(t, { fill: "none", ...l }, e, n) : vt(t, { fill: "white" }, e, n);
}
function ar(t, e) {
  if (!e || t.kind !== "shape") return !1;
  const n = t.props ?? {};
  if ((n.geometry ?? n.kind) !== "rect") return !1;
  const r = t.metadata, o = typeof r == "object" && r !== null ? r.strokeDetails : void 0, s = typeof o == "object" && o !== null ? o.strokeAlign : void 0;
  if ((n.stroke_align ?? s) !== "INSIDE") return !1;
  const a = n.stroke, l = typeof a == "string" || typeof a == "object" && a !== null && typeof a.color == "string", u = typeof n.fill == "string" || Array.isArray(n.fills) && n.fills.length > 0;
  if (!l || u || q(e.blur, 0) <= 0 || e.blendMode === "lighten") return !1;
  const f = q(n.width, 0), p = q(n.height, 0), m = q(e.x, 0), h = q(e.y, 0);
  return f <= 0 || p <= 0 ? !1 : m >= f * 0.7 && h < p * 0.8;
}
let ee = 0;
function lr() {
  return ee = (ee + 1) % 1e6, `lumen-mask-img-${ee.toString(36)}`;
}
function cr(t) {
  switch (t) {
    case "cover":
      return "xMidYMid slice";
    case "fill":
      return "none";
    case "none":
      return "xMidYMid meet";
    case "scale-down":
      return "xMidYMid meet";
    case "contain":
    default:
      return "xMidYMid meet";
  }
}
function ur(t) {
  const e = t.metadata;
  if (typeof e != "object" || e === null) return;
  const n = e.figma;
  if (typeof n != "object" || n === null) return;
  const i = n.imagePaint;
  return typeof i == "object" && i !== null ? i : void 0;
}
function Bt(t, e, n = 4096) {
  const i = typeof t == "number" && Number.isFinite(t) ? t : e;
  return Math.min(n, Math.max(1, i));
}
function fr(t, e, n, i, r, o) {
  const s = Yt(e.src, r, "mask.source.image.src", n, o);
  if (!s) return null;
  const c = Bt(e.width, 1), a = Bt(e.height, 1), l = typeof e.opacity == "number" && Number.isFinite(e.opacity) ? Math.min(1, Math.max(0, e.opacity)) : void 0, u = q(e.rotation, 0), f = e.flipY === !0, p = ur(t), m = p?.scalingFactor ?? e.imageScaleFactor, h = typeof m == "number" && Number.isFinite(m) && m > 0 ? Math.min(1, m) : 1, v = (p?.scaleMode ?? e.imageScaleMode) === "TILE", b = cr(e.fit), y = [];
  f && y.push(`translate(0 ${a}) scale(1 -1)`), u !== 0 && y.push(`rotate(${u} ${c / 2} ${a / 2})`);
  const g = y.length > 0 ? y.join(" ") : void 0;
  let $;
  if (v) {
    const T = Bt(p?.tileWidth, 1200 * h), w = Bt(p?.tileHeight, 1200 * h), x = lr();
    $ = /* @__PURE__ */ C(et, { children: [
      /* @__PURE__ */ d("defs", { children: /* @__PURE__ */ d(
        "pattern",
        {
          id: x,
          patternUnits: "userSpaceOnUse",
          width: T,
          height: w,
          children: /* @__PURE__ */ d(
            "image",
            {
              href: s,
              x: 0,
              y: 0,
              width: T,
              height: w,
              preserveAspectRatio: "none",
              ...l === void 0 ? {} : { opacity: l }
            }
          )
        }
      ) }),
      /* @__PURE__ */ d("rect", { x: 0, y: 0, width: c, height: a, fill: `url(#${x})` })
    ] });
  } else
    $ = /* @__PURE__ */ d(
      "image",
      {
        href: s,
        x: 0,
        y: 0,
        width: c,
        height: a,
        preserveAspectRatio: b,
        ...l === void 0 ? {} : { opacity: l }
      }
    );
  return /* @__PURE__ */ d("g", { ...g === void 0 ? {} : { transform: g }, children: $ }, i);
}
const dr = 64, yt = 1;
function ye(t) {
  return t.props?.visible === !1;
}
function Mt(t, e) {
  const n = t?.[e];
  return typeof n == "number" && Number.isFinite(n) ? n : 0;
}
function Ue(t, e, n = yt, i = dr, r = !1, o, s, c) {
  if (t.kind !== "frame") return null;
  const a = vn(
    t,
    e,
    n,
    i,
    "grp",
    r,
    o,
    s,
    c
  );
  if (a.length === 0) return null;
  const l = Mt(t.props, "x"), u = Mt(t.props, "y");
  return /* @__PURE__ */ d(
    "g",
    {
      ...l !== 0 || u !== 0 ? { transform: `translate(${l} ${u})` } : {},
      children: a
    },
    "mask-group-cover"
  );
}
function le(t, e = yt, n = !1) {
  if (t.kind !== "frame") return !1;
  for (const i of t.children ?? [])
    if (!(!n && ye(i)) && (Mt(i.props, "blur") > 0 || i.kind === "frame" && e > 0 && le(i, e - 1, n)))
      return !0;
  return !1;
}
function He(t) {
  if (t.kind !== "frame") return null;
  const e = t.props ?? {}, n = q(e.width, 0), i = q(e.height, 0);
  if (n <= 0 || i <= 0) return null;
  const r = (t.children ?? []).filter((m) => !ye(m));
  if (r.length !== 1) return null;
  const o = r[0];
  if (o?.kind !== "shape") return null;
  const s = o.props ?? {};
  if (xn(s) !== "rect" || q(s.blur, 0) > 0 || s.stroke !== void 0 || Array.isArray(s.strokes) && s.strokes.length > 0)
    return null;
  const c = 0.01, a = q(s.x, 0), l = q(s.y, 0), u = q(s.width, 0), f = q(s.height, 0), p = q(s.radius, 0);
  return u <= 0 || f <= 0 || Math.abs(a) > c || Math.abs(l) > c || Math.abs(u - n) > c || Math.abs(f - i) > c || p <= 0 ? null : Math.min(p, n / 2, i / 2);
}
function vn(t, e, n, i, r, o, s, c, a) {
  const l = t.children ?? [], u = [];
  let f = 0;
  for (let p = 0; p < l.length; p++) {
    const m = l[p];
    if (!o && ye(m)) continue;
    if (f >= i) {
      E(
        e,
        "mask.source.ref",
        `group mask exceeds the ${i}-child composite cap ; remainder truncated (ADR 002 A4.4 T5)`
      );
      break;
    }
    let h = null;
    if (m.kind === "shape") {
      const y = m.props ?? {};
      h = kn(
        wn(y, m.id, `${r}-${p}`),
        y,
        `${r}-${p}`
      );
    } else if (m.kind === "image") {
      const y = s?.(m) ?? m.props ?? {};
      h = fr(
        m,
        y,
        e,
        `${r}-${p}`,
        c,
        a
      );
    } else if (m.kind === "frame" && n > 0) {
      const y = vn(
        m,
        e,
        n - 1,
        i,
        `${r}-${p}`,
        o,
        s,
        c,
        a
      );
      y.length > 0 && (h = /* @__PURE__ */ d("g", { children: y }, `${r}-${p}`));
    }
    if (h === null) continue;
    const k = Mt(m.props, "blur");
    if (k > 0) {
      const y = `lumen-mcov-blur-${e ?? "x"}-${r}-${p}`;
      h = /* @__PURE__ */ C("g", { children: [
        /* @__PURE__ */ d("filter", { id: y, x: "-120%", y: "-120%", width: "340%", height: "340%", children: /* @__PURE__ */ d("feGaussianBlur", { stdDeviation: k / 2 }) }),
        /* @__PURE__ */ d("g", { filter: `url(#${y})`, children: h })
      ] }, `${r}-b-${p}`);
    }
    const v = Mt(m.props, "x"), b = Mt(m.props, "y");
    u.push(
      v !== 0 || b !== 0 ? /* @__PURE__ */ d("g", { transform: `translate(${v} ${b})`, children: h }, `${r}-t-${p}`) : h
    ), f++;
  }
  return u;
}
function We({ noise: t, texture: e, glass: n }) {
  const i = Cn();
  return !t && !e && !n ? null : /* @__PURE__ */ C(et, { children: [
    t && /* @__PURE__ */ d(Ge, { kind: "noise", effect: t, filterId: `${i}-noise` }),
    e && /* @__PURE__ */ d(Ge, { kind: "texture", effect: e, filterId: `${i}-texture` }),
    n && /* @__PURE__ */ d(hr, { effect: n })
  ] });
}
function Ye(t, e) {
  if (!t) return e;
  const n = Math.round((ft(t.r) ?? 0) * 255), i = Math.round((ft(t.g) ?? 0) * 255), r = Math.round((ft(t.b) ?? 0) * 255), o = ft(t.a) ?? 0;
  return `rgba(${n}, ${i}, ${r}, ${o.toFixed(3)})`;
}
function Ge({
  kind: t,
  effect: e,
  filterId: n
}) {
  const i = t === "texture", r = e.noiseSize, o = Math.max(0.5, st("noiseSize", r) ?? 0.5), s = ft(1 / (o * (i ? 6 : 2.5))) ?? 0, c = i ? "MONOTONE" : e.noiseType, a = i || c === "MONOTONE", l = !i && c === "DUOTONE", u = i ? 0.4 : ft(e.density) ?? 0, f = i ? void 0 : Ye(e.color, "rgba(255,255,255,0.7)"), p = l && !i ? Ye(e.secondaryColor, "rgba(0,0,0,0.7)") : void 0;
  return /* @__PURE__ */ C(et, { children: [
    /* @__PURE__ */ d("svg", { width: "0", height: "0", style: { position: "absolute" }, "aria-hidden": "true", children: /* @__PURE__ */ d("defs", { children: /* @__PURE__ */ C("filter", { id: n, x: "0", y: "0", width: "100%", height: "100%", children: [
      /* @__PURE__ */ d(
        "feTurbulence",
        {
          type: "fractalNoise",
          baseFrequency: s,
          numOctaves: i ? 3 : 2,
          seed: 7,
          stitchTiles: "stitch",
          result: "turb"
        }
      ),
      /* @__PURE__ */ d(
        "feColorMatrix",
        {
          in: "turb",
          type: "matrix",
          values: a ? "0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0.35 0.35 0.35 0 0" : "1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0.35 0.35 0.35 0 0"
        }
      )
    ] }) }) }),
    /* @__PURE__ */ d(
      "div",
      {
        "aria-hidden": "true",
        style: {
          position: "absolute",
          inset: 0,
          pointerEvents: "none",
          filter: `url(#${n})`,
          opacity: u,
          mixBlendMode: i ? "multiply" : a ? "overlay" : "normal",
          background: a ? f : p ? `linear-gradient(135deg, ${f}, ${p})` : f
        }
      }
    )
  ] });
}
function hr({ effect: t }) {
  const e = In(t.lightAngle), n = ft(t.lightIntensity) ?? 0;
  if (n <= 0) return null;
  const i = 15 + (ft(t.splay) ?? 0) * 45, r = {
    position: "absolute",
    inset: 0,
    pointerEvents: "none",
    background: `linear-gradient(${e}deg, rgba(255,255,255,${(n * 0.5).toFixed(3)}) 0%, transparent ${i}%, transparent ${100 - i}%, rgba(0,0,0,${(n * 0.15).toFixed(3)}) 100%)`,
    mixBlendMode: "overlay"
  };
  return /* @__PURE__ */ d("div", { "aria-hidden": "true", style: r });
}
const pr = 0.425;
function be(t, e) {
  const n = st("blur", t), i = Dn(e);
  return n !== null && n > 0 ? n === _t && i !== null ? Array.from(
    { length: i },
    () => `blur(${_t}px)`
  ).join(" ") : n === _t ? `blur(${_t}px)` : `blur(${n * pr}px)` : void 0;
}
function Ve(t) {
  switch (t) {
    case "fixed":
      return "0 0 auto";
    case "hug":
      return "0 1 auto";
    case "fill":
      return "1 1 auto";
    default:
      return;
  }
}
function mr(t) {
  const e = Ve(t?.x), n = Ve(t?.y);
  return e === n && e !== void 0 ? e : e ?? n;
}
function Xe({
  visible: t,
  opacity: e,
  rotation: n,
  flipY: i,
  blur: r,
  staticBlurPasses: o,
  backdropBlur: s,
  noise: c,
  texture: a,
  glass: l,
  sizing: u,
  position: f,
  size: p,
  blendMode: m,
  children: h
}) {
  if (t === !1)
    return null;
  const k = tt(m), v = st("blur", r), b = st("backdropBlur", s), y = l ? st("backdropBlur", l.radius) : null, g = (b ?? 0) + (y ?? 0), $ = g > 0 ? st("backdropBlur", g) ?? 0 : 0, T = typeof e == "number" && e !== 1, w = typeof n == "number" && n !== 0, x = i === !0, S = v !== null && v > 0, O = $ > 0, z = c !== void 0 || a !== void 0, j = l ? ft(l.lightIntensity) ?? 0 : 0, D = l !== void 0 && j > 0, P = z || D, X = u?.x !== void 0 || u?.y !== void 0, R = f !== void 0, M = k !== void 0;
  if (!T && !w && !x && !S && !O && !P && !X && !R && !M)
    return /* @__PURE__ */ d(et, { children: h });
  let I;
  if (w || x) {
    const G = [];
    w && G.push(`rotate(${n}deg)`), x && G.push("scaleY(-1)"), I = G.join(" ");
  }
  const N = be(r, o), U = O ? `blur(${$}px)` : void 0, Z = X ? mr(u) : void 0;
  if (M && (T || I !== void 0 || N !== void 0 || U !== void 0)) {
    const G = { mixBlendMode: k };
    R && (G.position = "absolute", G.left = f.x, G.top = f.y), Z !== void 0 && (G.flex = Z);
    const B = {};
    return typeof p?.w == "number" && (B.width = p.w), typeof p?.h == "number" && (B.height = p.h), T && (B.opacity = e), I !== void 0 && (B.transform = I), N !== void 0 && (B.filter = N), U !== void 0 && (B.backdropFilter = U, B.WebkitBackdropFilter = U), P && (B.position = "relative"), /* @__PURE__ */ d("div", { style: G, children: /* @__PURE__ */ C("div", { style: B, children: [
      h,
      P && /* @__PURE__ */ d(We, { noise: c, texture: a, glass: l })
    ] }) });
  }
  const L = {};
  return T && (L.opacity = e), I !== void 0 && (L.transform = I), N !== void 0 && (L.filter = N), U !== void 0 && (L.backdropFilter = U, L.WebkitBackdropFilter = U), M && (L.mixBlendMode = k), R ? (L.position = "absolute", L.left = f.x, L.top = f.y, typeof p?.w == "number" && (L.width = p.w), typeof p?.h == "number" && (L.height = p.h)) : P && (L.position = "relative"), Z !== void 0 && (L.flex = Z), /* @__PURE__ */ C("div", { style: L, children: [
    h,
    P && /* @__PURE__ */ d(We, { noise: c, texture: a, glass: l })
  ] });
}
function gr({
  resolved: t,
  nodeId: e,
  transitionFor: n,
  animateInitial: i,
  staticRender: r = !1,
  renderBlurInsideShape: o = !1
}) {
  const s = t.geometry ?? t.kind ?? "rect", c = (s === "path" || s === "circle") && Array.isArray(t.stroke_geometry) && t.stroke_geometry.length > 0, a = ne(t.fill, "shape.fill", e) ?? "transparent", l = typeof t.stroke == "string" ? ne(t.stroke, "shape.stroke", e) ?? "transparent" : "transparent", u = Ct(t.stroke_width, 0), f = kr(t.stroke_align), p = Ct(t.width, 100), m = Ct(t.height, 100), h = Ct(t.opacity, 1), k = typeof t.ariaLabel == "string" ? t.ariaLabel : void 0, v = Gt(n, ["opacity"], i), b = At(v), y = Vt({ opacity: h }, i, e), g = Tt(), $ = Et(), T = se(
    Dt(Ot(t.fills, "shape.fills", e), "shape.fills", e),
    g,
    "shape.fills",
    e,
    $
  ), w = qe(t.strokes), x = w.length > 0 ? w : qe(t.stroke), S = pe(t.shadow, e, "shape.shadow.color"), O = o ? be(
    typeof t.blur == "number" ? t.blur : void 0,
    typeof t.staticBlurPasses == "number" ? t.staticBlurPasses : void 0
  ) : void 0, z = T.map((A) => Lt(A)), j = x.map((A) => {
    if (A.fill === void 0 || typeof A.fill != "object" || A.fill === null)
      return null;
    const [_] = se(
      Dt([A.fill], "shape.strokes.fill", e),
      g,
      "shape.strokes.fill",
      e,
      $
    );
    return _ ? Lt(
      _,
      s === "path" || s === "circle" ? { authoredBox: { width: p, height: m } } : {}
    ) : null;
  }), D = [
    ...z.flatMap((A) => A.defs),
    ...j.flatMap((A) => A ? A.defs : [])
  ], P = z.length > 0 ? z.map((A) => ({ ref: A.ref, mixBlendMode: A.mixBlendMode })) : [{ ref: a }], X = x.length > 0 ? x.map((A, _) => ({
    color: j[_]?.ref ?? ne(A.color, "shape.strokes.color", e) ?? "transparent",
    width: A.width ?? 0,
    align: A.align ?? f
  })) : [{ color: l, width: u, align: f }], R = P, M = [...X].reverse(), I = s === "path" ? M.filter((A) => A.width > 0 && A.color !== "transparent") : M, N = s === "path" && m === 0 ? vi(me(t, e)) : null, U = N?.minY ?? 0, Z = N?.maxY ?? 0, L = N === null ? 0 : Math.max(0, Z - U), G = N === null ? m : L, B = S.outerBoxShadow, W = S.innerShadows?.map((A, _) => ({
    innerShadow: A,
    id: xr(e, A, _, p, m)
  })) ?? [], F = z.length > 0 ? R : [], V = (A, _, at, lt, jn) => vt(
    t,
    {
      fill: A,
      stroke: _.color,
      strokeWidth: _.width,
      strokeAlign: _.align,
      mixBlendMode: lt,
      filter: jn
    },
    e,
    at
  ), H = r ? "svg" : xt.svg;
  return /* @__PURE__ */ C(
    H,
    {
      width: p,
      height: G,
      viewBox: N === null ? `0 0 ${p} ${m}` : `0 ${U} ${p} ${L}`,
      ...k !== void 0 ? { "aria-label": k, role: "img" } : {},
      style: {
        // SVG is an atomic visual primitive, not inline text. Keeping the
        // default inline baseline would add a font-dependent descent inside
        // absolute wrappers (the 8px Figma underline was shifted ~6px down).
        display: "block",
        // Keep the authored static shape opacity in the DOM as well as in
        // Framer's animation target. `motion.svg` does not necessarily
        // materialize an unchanged target value, so omitting this would make
        // imported Figma shape paints render fully opaque.
        opacity: h,
        // Figma exports line-like path geometry with an authored height of
        // zero while the stroke itself extends above/below the centreline.
        // Chromium's default SVG overflow clips that paint completely. Keep
        // the zero-height layout box, but let only path geometry escape it so
        // dashed separators and other zero-height vector lines remain visible.
        ...(s === "path" || s === "circle") && (m === 0 || c) ? { overflow: "visible" } : {},
        ...N !== null ? { transform: `translateY(${U}px)` } : {},
        ...S.filter !== void 0 ? { filter: S.filter } : {},
        ...B !== void 0 ? { boxShadow: B } : {}
      },
      ...r ? {} : { initial: y.initial, animate: y.animate, transition: b },
      children: [
        (D.length > 0 || W.length > 0) && /* @__PURE__ */ C("defs", { children: [
          D,
          W.map(({ id: A, innerShadow: _ }) => /* @__PURE__ */ d(
            yr,
            {
              id: A,
              width: p,
              height: m,
              shadow: _
            },
            A
          ))
        ] }),
        R.map(
          (A, _) => V(
            A.ref,
            { color: "transparent", width: 0 },
            `fill-${_}`,
            A.mixBlendMode,
            O
          )
        ),
        I.map(
          (A, _) => V("none", A, `stroke-${_}`, void 0, O)
        ),
        W.map(({ id: A, innerShadow: _ }) => /* @__PURE__ */ C(
          "g",
          {
            style: {
              filter: `url(#${A})`,
              mixBlendMode: br(_.blendMode)
            },
            children: [
              F.map(
                (at, lt) => V("white", { color: "transparent", width: 0 }, `inner-fill-${lt}`)
              ),
              I.map(
                (at, lt) => V(
                  "none",
                  { color: "white", width: at.width, align: at.align },
                  `inner-stroke-${lt}`
                )
              )
            ]
          },
          `inner-shadow-${A}`
        ))
      ]
    }
  );
}
function yr({
  id: t,
  width: e,
  height: n,
  shadow: i
}) {
  const r = Math.max(1, e, n);
  return /* @__PURE__ */ C(
    "filter",
    {
      id: t,
      x: -r,
      y: -r,
      width: e + r * 2,
      height: n + r * 2,
      filterUnits: "userSpaceOnUse",
      primitiveUnits: "userSpaceOnUse",
      colorInterpolationFilters: "sRGB",
      children: [
        /* @__PURE__ */ d(
          "feGaussianBlur",
          {
            in: "SourceAlpha",
            stdDeviation: Math.max(0, i.blur / 2),
            result: "inner-shadow-blur"
          }
        ),
        /* @__PURE__ */ d("feOffset", { in: "inner-shadow-blur", dx: i.x, dy: i.y, result: "inner-shadow-offset" }),
        /* @__PURE__ */ d(
          "feComposite",
          {
            in: "SourceAlpha",
            in2: "inner-shadow-offset",
            operator: "out",
            result: "inner-shadow-mask"
          }
        ),
        /* @__PURE__ */ d("feFlood", { floodColor: i.color, result: "inner-shadow-color" }),
        /* @__PURE__ */ d(
          "feComposite",
          {
            in: "inner-shadow-color",
            in2: "inner-shadow-mask",
            operator: "in",
            result: "inner-shadow-paint"
          }
        ),
        /* @__PURE__ */ d("feMerge", { children: /* @__PURE__ */ d("feMergeNode", { in: "inner-shadow-paint" }) })
      ]
    }
  );
}
function br(t) {
  if (t === "plus-lighter") return "plus-lighter";
  switch (t) {
    case "multiply":
    case "screen":
    case "overlay":
    case "darken":
    case "lighten":
    case "color-dodge":
    case "color-burn":
    case "hard-light":
    case "soft-light":
    case "difference":
    case "exclusion":
    case "hue":
    case "saturation":
    case "color":
    case "luminosity":
      return t;
    default:
      return "normal";
  }
}
function xr(t, e, n, i, r) {
  const o = `${t ?? "anonymous"}:${n}:${i}:${r}:${JSON.stringify(e)}`;
  let s = 2166136261;
  for (let a = 0; a < o.length; a += 1)
    s ^= o.charCodeAt(a), s = Math.imul(s, 16777619);
  return `lumencast-shape-inner-${(t ?? "anonymous").replace(/[^a-zA-Z0-9_-]/g, "-")}-${(s >>> 0).toString(16)}`;
}
function ne(t, e, n) {
  if (typeof t != "string") return null;
  const i = it(t);
  return i === null && rt(e, n), i;
}
function qe(t) {
  return (Array.isArray(t) ? t : t === void 0 ? [] : [t]).filter(
    (n) => typeof n == "object" && n !== null && ("color" in n || "fill" in n || "width" in n)
  );
}
function kr(t) {
  return t === "INSIDE" || t === "OUTSIDE" || t === "CENTER" ? t : void 0;
}
function Ct(t, e) {
  return typeof t == "number" && Number.isFinite(t) ? t : e;
}
function xe({
  peerLabel: t,
  objectFit: e,
  muted: n
}) {
  const i = he(), r = i?.resolvePeerStream, o = i?.subscribePeerStream, s = n ?? !i?.liveAudio, c = kt(null), [a, l] = Wt(null);
  return ht(() => {
    if (o !== void 0)
      return o(t, l);
    if (r !== void 0) {
      l(r(t));
      return;
    }
    l(null);
  }, [t, r, o]), ht(() => {
    const u = c.current;
    if (u !== null)
      return u.srcObject = a, () => {
        u !== null && (u.srcObject = null);
      };
  }, [a]), ht(() => {
    const u = c.current;
    u !== null && (u.muted = s);
  }, [s, a]), a === null ? /* @__PURE__ */ d(
    "div",
    {
      "aria-hidden": !0,
      "data-lumencast-media-live": !0,
      style: { width: "100%", height: "100%", opacity: 0, pointerEvents: "none" }
    }
  ) : /* @__PURE__ */ d(
    "video",
    {
      ref: c,
      "data-lumencast-media-live": !0,
      autoPlay: !0,
      muted: !0,
      playsInline: !0,
      style: {
        width: "100%",
        height: "100%",
        objectFit: e,
        pointerEvents: "none"
      }
    }
  );
}
function wr({ resolved: t, nodeId: e }) {
  const n = Tt(), i = Et(), r = t.fit ?? "cover", o = typeof t.peerLabel == "string" && t.peerLabel.length > 0 ? t.peerLabel : "";
  if (o !== "")
    return /* @__PURE__ */ d(xe, { peerLabel: o, objectFit: r });
  const s = Yt(t.src, n, "media.src", e, i);
  if (!s) return null;
  const c = t.loop ?? !0, a = t.mute ?? !0, l = t.autoplay ?? !0;
  return /* @__PURE__ */ d(
    "video",
    {
      src: s,
      autoPlay: l,
      loop: c,
      muted: a,
      playsInline: !0,
      style: vr(r)
    }
  );
}
function vr(t) {
  return {
    width: "100%",
    height: "100%",
    objectFit: t
  };
}
function Sr({ resolved: t }) {
  const e = typeof t.peer_label == "string" && t.peer_label.length > 0 ? t.peer_label : "";
  if (e === "")
    return /* @__PURE__ */ d(
      "div",
      {
        "aria-hidden": !0,
        "data-lumencast-meet-peer": !0,
        style: { width: "100%", height: "100%", opacity: 0, pointerEvents: "none" }
      }
    );
  const n = typeof t.object_fit == "string" && t.object_fit.length > 0 ? t.object_fit : "cover", i = typeof t.muted == "boolean" ? t.muted : void 0;
  return /* @__PURE__ */ d(xe, { peerLabel: e, objectFit: n, muted: i });
}
function $r({ resolved: t }) {
  const e = typeof t["x-zab.slotRef"] == "string" && t["x-zab.slotRef"].length > 0 ? t["x-zab.slotRef"] : "";
  return e === "" ? /* @__PURE__ */ d(
    "div",
    {
      "aria-hidden": !0,
      "data-lumencast-meet-peer-slot": !0,
      style: { width: "100%", height: "100%", opacity: 0, pointerEvents: "none" }
    }
  ) : /* @__PURE__ */ d(xe, { peerLabel: e, objectFit: "cover" });
}
const Ke = /* @__PURE__ */ new Set();
function Mr({ resolved: t, nodeId: e }) {
  const n = t.scene_id, i = t.scene_version;
  if (!n || !i)
    return E(e, "instance.scene_id", "missing scene_id or scene_version ; not rendered"), null;
  const r = `${n}:${i}`;
  Ke.has(r) || (Ke.add(r), E(
    e,
    "instance",
    "scaffold render — async bundle fetch + __params.* injection are not yet wired (LSML 1.1 §4.9)"
  ));
  const o = t.size, s = t.position;
  return /* @__PURE__ */ d(
    "div",
    {
      "data-lumencast-instance": n,
      "data-lumencast-version": i,
      style: {
        position: s ? "absolute" : "relative",
        left: s?.x,
        top: s?.y,
        width: o?.w,
        height: o?.h,
        outline: "none",
        boxSizing: "border-box"
      }
    }
  );
}
const Ft = /* @__PURE__ */ new Map();
async function Ar(t, e, n) {
  const i = navigator.mediaDevices, r = await n?.(e, t) ?? null, o = r?.deviceId, s = r?.captureSourceId, c = e.length > 0;
  let a, l;
  switch (t) {
    case "media.webcam":
    case "media.mic":
    case "media.app_audio": {
      if (c && (typeof o != "string" || o.length === 0))
        return { kind: "placeholder" };
      const h = t === "media.webcam" ? "video" : "audio";
      a = typeof o == "string" && o.length > 0 ? o : "default", l = () => i.getUserMedia({ [h]: Rr(o) });
      break;
    }
    case "media.screen":
    case "media.window":
    case "media.app": {
      if (typeof s == "string" && s.length > 0) {
        a = s, l = () => i.getUserMedia({
          video: {
            mandatory: {
              chromeMediaSource: "desktop",
              chromeMediaSourceId: s
            }
          }
        });
        break;
      }
      if (c) return { kind: "placeholder" };
      a = "display", l = () => i.getDisplayMedia({ video: !0 });
      break;
    }
    default:
      return { kind: "placeholder" };
  }
  const u = `${t}:${a}`, f = Ft.get(u);
  if (f)
    return f.refs += 1, { kind: "stream", key: u, promise: f.promise };
  const p = l(), m = { promise: p, stream: null, refs: 1 };
  return Ft.set(u, m), p.then((h) => {
    m.stream = h;
  }).catch(() => {
    Ft.delete(u);
  }), { kind: "stream", key: u, promise: p };
}
function Ze(t) {
  const e = Ft.get(t);
  e !== void 0 && (e.refs -= 1, !(e.refs > 0) && (Ft.delete(t), e.stream !== null && Fr(e.stream)));
}
function Rr(t) {
  return typeof t == "string" && t.length > 0 ? { deviceId: { exact: t } } : !0;
}
function Fr(t) {
  for (const e of t.getTracks()) e.stop();
}
function Nr({ resolved: t }) {
  const e = Je(t.width, "100%"), n = Je(t.height, "100%"), i = typeof t["x-zab.sourceKind"] == "string" ? t["x-zab.sourceKind"] : "", r = typeof t["x-zab.deviceRef"] == "string" ? t["x-zab.deviceRef"] : "", s = he()?.resolveCaptureDevice, c = kt(null), [a, l] = Wt(null);
  if (ht(() => {
    if (!Tr()) return;
    let u = !1, f = null;
    return (async () => {
      try {
        const p = await Ar(i, r, s);
        if (p.kind === "placeholder") return;
        const m = await p.promise;
        if (u) {
          Ze(p.key);
          return;
        }
        f = p.key, l(m);
      } catch {
      }
    })(), () => {
      u = !0, f !== null && Ze(f);
    };
  }, [i, r, s]), ht(() => {
    const u = c.current;
    if (u !== null)
      return u.srcObject = a, () => {
        u !== null && (u.srcObject = null);
      };
  }, [a]), a !== null && Er(i)) {
    const u = t.fit ?? "cover";
    return /* @__PURE__ */ d(
      "video",
      {
        ref: c,
        "data-lumencast-capture": !0,
        autoPlay: !0,
        muted: !0,
        playsInline: !0,
        style: {
          width: e,
          height: n,
          objectFit: u,
          pointerEvents: "none"
        }
      }
    );
  }
  return /* @__PURE__ */ d(
    "div",
    {
      "aria-hidden": !0,
      "data-lumencast-capture": !0,
      style: { width: e, height: n, opacity: 0, pointerEvents: "none" }
    }
  );
}
function Tr() {
  return typeof navigator < "u" && typeof navigator.mediaDevices?.getUserMedia == "function";
}
function Er(t) {
  return Hn.has(t);
}
function Je(t, e) {
  return typeof t == "number" && Number.isFinite(t) ? `${t}px` : typeof t == "string" && t.length > 0 ? t : e;
}
const Or = {
  stack: Gn,
  grid: Vn,
  frame: li,
  text: Bi,
  image: Qi,
  shape: gr,
  media: wr,
  // ADR 006 §3.3/§3.5 — the unified source kind : every exported source is a
  // `meet.peer` node rendered in `<video srcObject>` from the WebRTC viewer.
  "meet.peer": Sr,
  instance: Mr,
  // RFC-0001 / ADR 004 — Zab vendor capture placeholder (transparent, inert).
  "x-zab.capture": Nr,
  // ADR Blue 009 §3.1 (Amendment 2) — Zab vendor meet-peer SLOT placeholder.
  // Carries only a logical `x-zab.slotRef` ; the host's slot-aware peer-stream
  // registry resolves `slotRef → peer_label → MediaStream` (transparent when
  // unbound). Closes the kind→primitive gap that left it an unknown-kind drop.
  "x-zab.meet-peer": $r
}, ce = de("");
function _r({ prefix: t, children: e }) {
  const n = Nt(ce), i = n ? `${n}.${t}` : t;
  return /* @__PURE__ */ d(ce.Provider, { value: i, children: e });
}
function qt() {
  return Nt(ce);
}
function Rt(t, e) {
  return !t || e.startsWith("__") ? e : `${t}.${e}`;
}
const jr = {
  linear: "linear",
  "ease-in": "easeIn",
  "ease-out": "easeOut",
  "ease-in-out": "easeInOut"
};
function Br(t, e) {
  const n = t.steps;
  if (!Array.isArray(n) || n.length < 2) return;
  const i = n[0], r = n[n.length - 1];
  if (i.at !== 0 || r.at !== 1) return;
  const o = n.map((c) => c.at), s = {};
  return Qe(n, "opacity", s, e), Qe(n, "filter", s, e), Pt(n, "scale", s), Pt(n, "translateX", s), Pt(n, "translateY", s), Pt(n, "rotate", s), {
    animate: s,
    transition: {
      duration: t.duration_ms / 1e3,
      ease: jr[t.easing ?? "linear"],
      times: o
    }
  };
}
function Qe(t, e, n, i) {
  let r = !1;
  const o = [];
  let s;
  for (const c of t) {
    let a = c[e];
    if (e === "filter" && a !== void 0) {
      const l = zn(a);
      l === null ? (hn("keyframes.steps[].filter", i), a = void 0) : a = l;
    }
    a !== void 0 ? (r = !0, s = a, o.push(a)) : o.push(s ?? (e === "opacity" ? 1 : Un));
  }
  r && (n[e] = o);
}
function Pt(t, e, n) {
  let i = !1;
  const r = [];
  let o;
  for (const s of t) {
    const c = s.transform?.[e];
    typeof c == "number" ? (i = !0, o = c, r.push(c)) : r.push(o ?? Cr(e));
  }
  if (i)
    if (e === "rotate")
      n.rotate = r.map((s) => `${s}deg`);
    else {
      const s = e === "translateX" ? "x" : e === "translateY" ? "y" : e;
      n[s] = r;
    }
}
function Cr(t) {
  return t === "scale" ? 1 : 0;
}
const ke = de(0), tn = 2e3;
function Pr(t, e) {
  if (e <= 0) return 0;
  const n = t * e;
  return n > tn ? tn : n;
}
function Lr({
  keyframes: t,
  store: e,
  nodeId: n,
  children: i
}) {
  fe();
  const r = qt(), o = Nt(ke), s = kt(void 0), c = kt(0);
  if (t.key !== void 0) {
    const u = e.signal(Rt(r, t.key)).value;
    s.current !== u && (s.current = u, c.current += 1);
  }
  const a = Br(t, n);
  if (!a)
    return /* @__PURE__ */ d(et, { children: i });
  const l = o > 0 ? { ...a.transition, delay: o / 1e3 } : a.transition;
  return /* @__PURE__ */ C(
    xt.div,
    {
      style: { position: "absolute", inset: 0 },
      initial: Dr(a.animate),
      animate: a.animate,
      transition: l,
      children: [
        /* @__PURE__ */ d(Ir, {}),
        i
      ]
    },
    c.current
  );
}
function Ir() {
  return ht(() => {
  }, []), null;
}
function Dr(t) {
  const e = {};
  for (const [n, i] of Object.entries(t))
    i.length > 0 && (e[n] = i[0]);
  return e;
}
function zr(t, e = (i) => requestAnimationFrame(i), n = (i) => cancelAnimationFrame(i)) {
  let i = /* @__PURE__ */ new Map(), r = null, o = null, s = null, c = !1, a = !1;
  const l = (f, p) => t(p, f), u = () => {
    s = null;
    const f = i;
    a = !0;
    try {
      f.forEach(l);
    } finally {
      a = !1, f.clear(), o !== null && o.size > 0 ? (i = o, o = null, r = f) : (i = f, o = null, r = null);
    }
  };
  return {
    push(f, p) {
      if (c) return;
      (a ? o ??= r ?? /* @__PURE__ */ new Map() : i).set(f, p), s === null && (s = e(u));
    },
    dispose() {
      c = !0, a || i.clear(), o?.clear(), r?.clear(), s !== null && (n(s), s = null);
    }
  };
}
const Ur = {
  aliceblue: 15792383,
  antiquewhite: 16444375,
  aqua: 65535,
  aquamarine: 8388564,
  azure: 15794175,
  beige: 16119260,
  bisque: 16770244,
  black: 0,
  blanchedalmond: 16772045,
  blue: 255,
  blueviolet: 9055202,
  brown: 10824234,
  burlywood: 14596231,
  cadetblue: 6266528,
  chartreuse: 8388352,
  chocolate: 13789470,
  coral: 16744272,
  cornflowerblue: 6591981,
  cornsilk: 16775388,
  crimson: 14423100,
  cyan: 65535,
  darkblue: 139,
  darkcyan: 35723,
  darkgoldenrod: 12092939,
  darkgray: 11119017,
  darkgreen: 25600,
  darkgrey: 11119017,
  darkkhaki: 12433259,
  darkmagenta: 9109643,
  darkolivegreen: 5597999,
  darkorange: 16747520,
  darkorchid: 10040012,
  darkred: 9109504,
  darksalmon: 15308410,
  darkseagreen: 9419919,
  darkslateblue: 4734347,
  darkslategray: 3100495,
  darkslategrey: 3100495,
  darkturquoise: 52945,
  darkviolet: 9699539,
  deeppink: 16716947,
  deepskyblue: 49151,
  dimgray: 6908265,
  dimgrey: 6908265,
  dodgerblue: 2003199,
  firebrick: 11674146,
  floralwhite: 16775920,
  forestgreen: 2263842,
  fuchsia: 16711935,
  gainsboro: 14474460,
  ghostwhite: 16316671,
  gold: 16766720,
  goldenrod: 14329120,
  gray: 8421504,
  green: 32768,
  greenyellow: 11403055,
  grey: 8421504,
  honeydew: 15794160,
  hotpink: 16738740,
  indianred: 13458524,
  indigo: 4915330,
  ivory: 16777200,
  khaki: 15787660,
  lavender: 15132410,
  lavenderblush: 16773365,
  lawngreen: 8190976,
  lemonchiffon: 16775885,
  lightblue: 11393254,
  lightcoral: 15761536,
  lightcyan: 14745599,
  lightgoldenrodyellow: 16448210,
  lightgray: 13882323,
  lightgreen: 9498256,
  lightgrey: 13882323,
  lightpink: 16758465,
  lightsalmon: 16752762,
  lightseagreen: 2142890,
  lightskyblue: 8900346,
  lightslategray: 7833753,
  lightslategrey: 7833753,
  lightsteelblue: 11584734,
  lightyellow: 16777184,
  lime: 65280,
  limegreen: 3329330,
  linen: 16445670,
  magenta: 16711935,
  maroon: 8388608,
  mediumaquamarine: 6737322,
  mediumblue: 205,
  mediumorchid: 12211667,
  mediumpurple: 9662683,
  mediumseagreen: 3978097,
  mediumslateblue: 8087790,
  mediumspringgreen: 64154,
  mediumturquoise: 4772300,
  mediumvioletred: 13047173,
  midnightblue: 1644912,
  mintcream: 16121850,
  mistyrose: 16770273,
  moccasin: 16770229,
  navajowhite: 16768685,
  navy: 128,
  oldlace: 16643558,
  olive: 8421376,
  olivedrab: 7048739,
  orange: 16753920,
  orangered: 16729344,
  orchid: 14315734,
  palegoldenrod: 15657130,
  palegreen: 10025880,
  paleturquoise: 11529966,
  palevioletred: 14381203,
  papayawhip: 16773077,
  peachpuff: 16767673,
  peru: 13468991,
  pink: 16761035,
  plum: 14524637,
  powderblue: 11591910,
  purple: 8388736,
  rebeccapurple: 6697881,
  red: 16711680,
  rosybrown: 12357519,
  royalblue: 4286945,
  saddlebrown: 9127187,
  salmon: 16416882,
  sandybrown: 16032864,
  seagreen: 3050327,
  seashell: 16774638,
  sienna: 10506797,
  silver: 12632256,
  skyblue: 8900331,
  slateblue: 6970061,
  slategray: 7372944,
  slategrey: 7372944,
  snow: 16775930,
  springgreen: 65407,
  steelblue: 4620980,
  tan: 13808780,
  teal: 32896,
  thistle: 14204888,
  tomato: 16737095,
  turquoise: 4251856,
  violet: 15631086,
  wheat: 16113331,
  white: 16777215,
  whitesmoke: 16119285,
  yellow: 16776960,
  yellowgreen: 10145074
};
function Hr(t) {
  const e = it(t);
  if (e === null) return null;
  if (e.startsWith("#")) return Wr(e);
  if (e.startsWith("rgb")) {
    const r = e.slice(e.indexOf("(") + 1, -1).split(",").map((f) => f.trim());
    if (r.length < 3) return null;
    const s = r[0].endsWith("%") ? 100 : 255, c = ie(r[0], s), a = ie(r[1], s), l = ie(r[2], s), u = r.length > 3 ? en(r[3]) : 1;
    return c === null || a === null || l === null || u === null ? null : [c, a, l, u];
  }
  if (e.startsWith("hsl")) {
    const r = e.slice(e.indexOf("(") + 1, -1).split(",").map((p) => p.trim());
    if (r.length < 3) return null;
    const o = Number(r[0].replace("deg", "")), s = Number(r[1].replace("%", "")) / 100, c = Number(r[2].replace("%", "")) / 100, a = r.length > 3 ? en(r[3]) : 1;
    if (![o, s, c].every(Number.isFinite) || a === null) return null;
    const [l, u, f] = Yr(o, s, c);
    return [l, u, f, a];
  }
  if (e === "transparent") return [0, 0, 0, 0];
  if (e === "currentcolor") return null;
  const n = Ur[e];
  return n === void 0 ? null : [(n >> 16 & 255) / 255, (n >> 8 & 255) / 255, (n & 255) / 255, 1];
}
function Wr(t) {
  const e = t.slice(1);
  if (e.length === 3 || e.length === 4) {
    const n = parseInt(e[0] + e[0], 16), i = parseInt(e[1] + e[1], 16), r = parseInt(e[2] + e[2], 16), o = e.length === 4 ? parseInt(e[3] + e[3], 16) : 255;
    return [n / 255, i / 255, r / 255, o / 255];
  }
  if (e.length === 6 || e.length === 8) {
    const n = parseInt(e.slice(0, 2), 16), i = parseInt(e.slice(2, 4), 16), r = parseInt(e.slice(4, 6), 16), o = e.length === 8 ? parseInt(e.slice(6, 8), 16) : 255;
    return [n / 255, i / 255, r / 255, o / 255];
  }
  return null;
}
function ie(t, e) {
  const n = Number(t.replace("%", ""));
  return Number.isFinite(n) ? Q(n / e) : null;
}
function en(t) {
  const e = t.endsWith("%"), n = Number(t.replace("%", ""));
  return Number.isFinite(n) ? Q(e ? n / 100 : n) : null;
}
function Yr(t, e, n) {
  const i = (t % 360 + 360) % 360, r = (1 - Math.abs(2 * n - 1)) * e, o = i / 60, s = r * (1 - Math.abs(o % 2 - 1));
  let c = 0, a = 0, l = 0;
  o < 1 ? [c, a, l] = [r, s, 0] : o < 2 ? [c, a, l] = [s, r, 0] : o < 3 ? [c, a, l] = [0, r, s] : o < 4 ? [c, a, l] = [0, s, r] : o < 5 ? [c, a, l] = [s, 0, r] : [c, a, l] = [r, 0, s];
  const u = n - r / 2;
  return [Q(c + u), Q(a + u), Q(l + u)];
}
function Gr(t, e, n) {
  return [
    Q(t[0] + n * (e[0] - t[0])),
    Q(t[1] + n * (e[1] - t[1])),
    Q(t[2] + n * (e[2] - t[2])),
    Q(t[3] + n * (e[3] - t[3]))
  ];
}
function nn(t) {
  const e = Math.round(Q(t[0]) * 255), n = Math.round(Q(t[1]) * 255), i = Math.round(Q(t[2]) * 255), r = Math.round(Q(t[3]) * 1e4) / 1e4;
  return `rgba(${e}, ${n}, ${i}, ${r})`;
}
function Q(t) {
  return t < 0 ? 0 : t > 1 ? 1 : t;
}
const Sn = {
  "style.color": "colour",
  fill: "fill",
  background: "background"
};
function Vr(t, e) {
  switch (t) {
    case "opacity": {
      const n = pt(e);
      return n === null ? null : { opacity: n < 0 ? 0 : n > 1 ? 1 : n };
    }
    case "transform.translate": {
      if (!Array.isArray(e) || e.length !== 2) return null;
      const n = pt(e[0]), i = pt(e[1]);
      return n === null || i === null ? null : { x: n, y: i };
    }
    case "transform.scale": {
      const n = pt(e);
      if (n !== null) return { scaleX: n, scaleY: n };
      if (Array.isArray(e) && e.length === 2) {
        const i = pt(e[0]), r = pt(e[1]);
        return i === null || r === null ? null : { scaleX: i, scaleY: r };
      }
      return null;
    }
    case "transform.rotate": {
      const n = pt(e);
      return n === null ? null : { rotate: n };
    }
    case "filter.blur": {
      const n = st("blur", e);
      return n === null ? null : { blur: n };
    }
    case "filter.brightness": {
      const n = st("brightness", e);
      return n === null ? null : { brightness: n };
    }
    default:
      return null;
  }
}
function pt(t) {
  return typeof t != "number" || !Number.isFinite(t) ? null : Object.is(t, -0) ? 0 : t;
}
const Xr = {
  kind: "spring",
  stiffness: 170,
  damping: 26,
  mass: 1
};
function qr(t) {
  switch (t) {
    case "opacity":
      return "opacity";
    case "transform.translate":
      return "x";
    case "transform.scale":
      return "scale";
    case "transform.rotate":
      return "rotate";
    case "filter.blur":
    case "filter.brightness":
      return "filter";
    default:
      return Sn[t] ?? t;
  }
}
const Kr = {};
function Zr(t, e, n) {
  const i = t.animateBindings, r = Nt(ke), s = he()?.realtimeDeltas === !0, c = dt(1), a = dt(0), l = dt(0), u = dt(1), f = dt(1), p = dt(0), m = dt(0), h = dt(1), k = Bn(
    [m, h],
    ([w, x]) => `blur(${w}px) brightness(${x})`
  ), [v, b] = Wt(Kr), y = kt({
    opacity: c,
    x: a,
    y: l,
    scaleX: u,
    scaleY: f,
    rotate: p,
    blur: m,
    brightness: h
  }), g = kt(null), $ = Pn(
    (w) => {
      g.current = w, w !== null && s && i && rn(w, y.current, k, i);
    },
    [i, k, s]
  );
  ht(() => {
    if (!i || Object.keys(i).length === 0) return;
    const w = y.current, x = /* @__PURE__ */ new Map(), S = /* @__PURE__ */ new Map(), O = /* @__PURE__ */ new Set();
    let z = !1;
    const j = (R, M) => {
      const N = e.transitionSignal(M).peek() ?? t.transitions?.[qr(R)], U = At(N ?? Xr);
      return r > 0 && !O.has(R) ? { ...U, delay: r / 1e3 } : U;
    }, D = (R, M, I, N) => {
      const U = Sn[R], Z = Rt(n, i[R]);
      if (U !== void 0) {
        const B = Hr(M);
        if (B === null) {
          rt(`bindAnimate.${R}`, t.id);
          return;
        }
        const W = S.get(R);
        if (I || N || W === void 0) {
          S.set(R, { current: B }), b((H) => ({ ...H, [U]: nn(B) }));
          return;
        }
        const F = W.current, V = j(R, Z);
        O.add(R), x.get(`color:${R}`)?.stop(), x.set(
          `color:${R}`,
          we(0, 1, {
            ...V,
            onUpdate: (H) => {
              const A = Gr(F, B, H);
              W.current = A, b((_) => ({ ..._, [U]: nn(A) }));
            }
          })
        );
        return;
      }
      const L = Vr(R, M);
      if (L === null) {
        R.startsWith("filter.") ? hn(`bindAnimate.${R}`, t.id) : Jr(R, t.id);
        return;
      }
      if (I || N) {
        for (const [B, W] of Object.entries(L))
          w[B].jump(W);
        N && g.current !== null && rn(g.current, w, k, i);
        return;
      }
      const G = j(R, Z);
      O.add(R);
      for (const [B, W] of Object.entries(L))
        x.set(B, we(w[B], W, G));
    }, P = zr((R, M) => D(R, M, !1, !1)), X = Object.entries(i).map(
      ([R, M]) => Yn(() => {
        const I = e.signal(Rt(n, M)).value;
        I !== void 0 && (z ? s ? D(R, I, !1, !0) : P.push(R, I) : D(R, I, !0, !1));
      })
    );
    return z = !0, () => {
      for (const R of X) R();
      P.dispose();
      for (const R of x.values()) R.stop();
    };
  }, [t, i, e, n, r, s]);
  const T = ut(() => {
    if (!i) return null;
    const w = {};
    let x = !1;
    for (const S of Object.keys(i))
      switch (S) {
        case "opacity":
          w.opacity = c, x = !0;
          break;
        case "transform.translate":
          w.x = a, w.y = l, x = !0;
          break;
        case "transform.scale":
          w.scaleX = u, w.scaleY = f, x = !0;
          break;
        case "transform.rotate":
          w.rotate = p, x = !0;
          break;
        case "filter.blur":
        case "filter.brightness":
          w.filter = k, x = !0;
          break;
      }
    return x ? (w.willChange = "transform, opacity, filter", w) : null;
  }, [i, c, a, l, u, f, p, k]);
  return {
    motionStyle: T,
    motionRef: s && T !== null ? $ : null,
    colorProps: v
  };
}
function rn(t, e, n, i) {
  const r = [];
  if (i["transform.translate"] !== void 0) {
    const o = e.x.get(), s = e.y.get();
    o !== 0 && r.push(`translateX(${o}px)`), s !== 0 && r.push(`translateY(${s}px)`);
  }
  if (i["transform.scale"] !== void 0) {
    const o = e.scaleX.get(), s = e.scaleY.get();
    o !== 1 && r.push(`scaleX(${o})`), s !== 1 && r.push(`scaleY(${s})`);
  }
  if (i["transform.rotate"] !== void 0) {
    const o = e.rotate.get();
    o !== 0 && r.push(`rotate(${o}deg)`);
  }
  if (t.style.transform = r.length > 0 ? r.join(" ") : "", i.opacity !== void 0) {
    const o = e.opacity.get();
    t.style.opacity = o === 1 ? "" : String(o);
  }
  (i["filter.blur"] !== void 0 || i["filter.brightness"] !== void 0) && (t.style.filter = n.get());
}
function Jr(t, e) {
  E(
    e,
    `bindAnimate.${t}`,
    "rejected bound value : JSON shape does not match the property type (LSML §6.3)"
  );
}
const $n = /* @__PURE__ */ new Set(["alpha", "luminance"]), Ut = 180, Mn = /* @__PURE__ */ new Set(["intersect", "subtract", "union"]);
let re = 0;
function Qr() {
  return re = (re + 1) % 1e6, `lumen-mask-${re.toString(36)}`;
}
function to(t) {
  return /^[A-Za-z0-9_:-]+$/.test(t) ? t : null;
}
function Y(t) {
  return typeof t == "number" && Number.isFinite(t);
}
function An(t, e) {
  if (typeof t != "object" || t === null) return null;
  const n = t;
  if (typeof n.type != "string" || !$n.has(n.type))
    return E(e, "mask.type", "is not alpha|luminance ; mask omitted (ADR 002 §3.2, T4)"), null;
  if (typeof n.op != "string" || !Mn.has(n.op))
    return E(
      e,
      "mask.op",
      "is not intersect|subtract|union ; mask omitted (ADR 002 §3.2, T4)"
    ), null;
  const i = n.source;
  if (typeof i != "object" || i === null)
    return E(e, "mask.source", "is not a typed shape|image source ; mask omitted (T3)"), null;
  const r = i;
  let o;
  if (r.kind === "shape" && typeof r.ref == "string")
    o = { kind: "shape", ref: r.ref };
  else if (r.kind === "image" && typeof r.src == "string") {
    const l = r.srcRect;
    o = l && Y(l.x) && Y(l.y) && Y(l.w) && Y(l.h) ? { kind: "image", src: r.src, srcRect: { x: l.x, y: l.y, w: l.w, h: l.h } } : { kind: "image", src: r.src };
  } else if (r.kind === "group" && typeof r.ref == "string")
    o = { kind: "group", ref: r.ref };
  else
    return E(
      e,
      "mask.source",
      "is not a typed shape|image|group source ; mask omitted (T3)"
    ), null;
  const s = { source: o, type: n.type, op: n.op }, c = n.position;
  c && Y(c.x) && Y(c.y) && (s.position = { x: c.x, y: c.y });
  const a = n.size;
  return a && Y(a.w) && Y(a.h) && (s.size = { w: a.w, h: a.h }), s;
}
function eo(t, e, n, i, r, o = !1, s, c) {
  if (!$n.has(t.type) || !Mn.has(t.op))
    return E(n, "mask", "type/op outside the closed enum ; mask omitted (T4)"), null;
  const a = Qr(), l = t.position?.x, u = t.position?.y, f = t.size?.w, p = t.size?.h, m = {
    ...Y(l) ? { x: l } : {},
    ...Y(u) ? { y: u } : {},
    ...Y(f) ? { width: f } : {},
    ...Y(p) ? { height: p } : {}
  };
  let h;
  if (t.source.kind === "image") {
    const y = Wn(t.source.src, e), g = typeof t.source.src == "string" && t.source.src.length <= 2048 && t.source.src.startsWith("blob:") && c?.(t.source.src) === !0 || y.allowed ? t.source.src : null;
    if (g === null)
      return E(
        n,
        "mask.source.src",
        `image host/scheme rejected ; mask omitted (T1/T2 — ${y.reason ?? "denied"})`
      ), null;
    if (t.op === "intersect") {
      const T = t.type === "alpha" ? "alpha" : "luminance", w = `url("${g}")`, x = t.source.srcRect, S = x && Y(x.x) && Y(x.y) && Y(x.w) && Y(x.h), O = S ? `${x.w}px ${x.h}px` : "cover", z = S ? `${x.x}px ${x.y}px` : "center";
      return {
        def: /* @__PURE__ */ d("defs", {}, a),
        style: {
          maskImage: w,
          WebkitMaskImage: w,
          maskSize: O,
          WebkitMaskSize: O,
          maskRepeat: "no-repeat",
          WebkitMaskRepeat: "no-repeat",
          maskPosition: z,
          WebkitMaskPosition: z,
          maskMode: T
        },
        id: a,
        feather: !1
      };
    }
    const $ = Object.keys(m).length > 0 ? m : Y(r?.w) && Y(r?.h) ? { x: 0, y: 0, width: r.w, height: r.h } : { width: "100%", height: "100%" };
    h = /* @__PURE__ */ d("image", { href: g, preserveAspectRatio: "none", ...$ });
  } else {
    const y = to(t.source.ref);
    if (y === null)
      return E(
        n,
        "mask.source.ref",
        "shape ref is not a safe id token ; mask omitted (T3)"
      ), null;
    const g = i?.(y, s) ?? null;
    if (g === null)
      return E(
        n,
        "mask.source.ref",
        "shape ref does not resolve to an indexed shape ; mask omitted (ADR 002 A2.1 #K)"
      ), null;
    h = Object.keys(m).length > 0 ? /* @__PURE__ */ d(
      "g",
      {
        transform: Y(m.x) || Y(m.y) ? `translate(${Y(m.x) ? m.x : 0} ${Y(m.y) ? m.y : 0})` : void 0,
        children: g
      }
    ) : g;
  }
  o && (h = /* @__PURE__ */ d("g", { transform: `translate(${Ut} ${Ut})`, children: h }, "feather-pad"));
  let k;
  t.op === "intersect" ? k = h : t.op === "union" ? k = /* @__PURE__ */ C(et, { children: [
    /* @__PURE__ */ d("rect", { x: 0, y: 0, width: "100%", height: "100%", fill: "white" }),
    h
  ] }) : k = /* @__PURE__ */ C(et, { children: [
    /* @__PURE__ */ d("rect", { x: 0, y: 0, width: "100%", height: "100%", fill: "white" }),
    /* @__PURE__ */ d("g", { style: { filter: "invert(1)" }, children: h })
  ] });
  const v = /* @__PURE__ */ d(
    "mask",
    {
      id: a,
      maskContentUnits: "userSpaceOnUse",
      x: "-50%",
      y: "-50%",
      width: "200%",
      height: "200%",
      ...t.type === "alpha" && t.source.kind !== "image" ? { "mask-type": "alpha" } : {},
      children: k
    },
    a
  ), b = `url(#${a})`;
  return { def: v, style: { mask: b, WebkitMask: b }, id: a, feather: o };
}
const Rn = /* @__PURE__ */ new Map(), Fn = de(Rn);
function Ao(t) {
  if (!t) return Rn;
  const e = /* @__PURE__ */ new Map(), n = [t];
  for (; n.length > 0; ) {
    const i = n.pop();
    (i.kind === "shape" || i.kind === "frame") && typeof i.id == "string" && i.id.length > 0 && (e.has(i.id) ? E(
      i.id,
      "id",
      "duplicate shape id ; first occurrence kept, later ones ignored (ADR 002 A2.1 #K)"
    ) : e.set(i.id, i));
    const o = i.children;
    if (o)
      for (let s = o.length - 1; s >= 0; s--) n.push(o[s]);
  }
  return e;
}
function Ro({
  index: t,
  children: e
}) {
  return /* @__PURE__ */ d(Fn.Provider, { value: t, children: e });
}
function no() {
  return Nt(Fn);
}
const io = {
  motionStyle: null,
  motionRef: null,
  colorProps: {}
}, ro = [], oo = [], so = [], Nn = [], on = [], ao = {
  frame: /* @__PURE__ */ new Set(["opacity", "scale", "rotate", "x", "y"]),
  image: /* @__PURE__ */ new Set(["opacity", "src"]),
  shape: /* @__PURE__ */ new Set(["opacity"]),
  text: /* @__PURE__ */ new Set(["opacity", "value"])
}, sn = /* @__PURE__ */ new WeakMap(), an = /* @__PURE__ */ new WeakMap();
function Kt(t) {
  if (t.bindings == null) return ro;
  const e = sn.get(t);
  if (e) return e;
  const n = Object.entries(t.bindings);
  return sn.set(t, n), n;
}
function lo(t) {
  const e = an.get(t);
  if (e !== void 0) return e;
  const n = (r, o) => {
    for (const s of r.children ?? [])
      if (s.props?.visible !== !1 && (s.kind === "image" && Kt(s).length > 0 || s.kind === "frame" && o > 0 && n(s, o - 1)))
        return !0;
    return !1;
  }, i = t.kind === "frame" && n(t, yt);
  return an.set(t, i), i;
}
function ln(t) {
  return Kt(t).length === 0 && Object.keys(t.animateBindings ?? {}).length === 0 && Object.keys(t.transitions ?? {}).length === 0 && Object.keys(t.animate_initial ?? {}).length === 0 && !t.keyframes;
}
function co({
  node: t,
  store: e,
  suppressBlendMode: n,
  renderBlurInsideShape: i
}) {
  if (t.kind === "repeat")
    return /* @__PURE__ */ d(yo, { node: t, store: e });
  const r = t.animateBindings && Object.keys(t.animateBindings).length > 0 ? uo : Tn;
  return /* @__PURE__ */ d(
    r,
    {
      node: t,
      store: e,
      suppressBlendMode: n,
      renderBlurInsideShape: i
    }
  );
}
const Ht = Ln(co);
Ht.displayName = "Tree";
function uo(t) {
  const e = qt(), n = Zr(t.node, t.store, e);
  return /* @__PURE__ */ d(Tn, { ...t, bindAnimate: n });
}
function Tn({
  node: t,
  store: e,
  suppressBlendMode: n = !1,
  renderBlurInsideShape: i = !1,
  bindAnimate: r = io
}) {
  fe();
  const o = qt(), s = Tt(), c = Et(), a = no(), l = Kt(t), u = ut(
    () => l.length === 0 ? oo : l.map(([, F]) => Rt(o, F)),
    [l, o]
  ), f = ut(
    () => u.length === 0 ? so : u.map((F) => e.signal(F)),
    [u, e]
  ), p = _n(f), m = ut(() => {
    const F = ao[t.kind];
    if (F === void 0) return on;
    const V = [];
    for (let H = 0; H < l.length; H += 1) {
      const A = l[H][0];
      F.has(A) && V.push([A, e.transitionSignal(u[H])]);
    }
    return V.length === 0 ? on : V;
  }, [l, u, t.kind, e]), h = ut(
    () => ue(t, l, p),
    // Signal reads above subscribe this node and become the memo dependencies.
    // Reuse their values here rather than looking up every signal a second time.
    [t, l, u, ...p]
  ), k = ut(
    () => t.children?.some(On) ?? !1,
    [t.children]
  );
  pn(t);
  const v = Or[t.kind];
  if (!v)
    return E(t.id, "kind", "unknown render kind ; node not rendered"), null;
  const b = h.mask !== void 0 ? An(h.mask, t.id) : null, y = b?.source.kind === "group" && /^[A-Za-z0-9_:-]+$/.test(b.source.ref) ? b.source.ref : void 0, g = y === void 0 ? void 0 : a.get(y), $ = ut(() => {
    if (g?.kind !== "frame") return;
    const F = le(g, yt, !1);
    return {
      feather: F,
      simpleRoundedMaskRadius: !F && b?.type === "alpha" && b.op === "intersect" ? He(g) : null
    };
  }, [g, b?.type, b?.op]), T = ut(() => {
    if (!(l.length === 0 || g?.kind !== "frame" || lo(g)))
      return Ue(
        g,
        g.id,
        yt,
        void 0,
        !1,
        void 0,
        s,
        c
      );
  }, [l.length, g, s, c]), w = {};
  for (const [F, V] of m) {
    const H = V.value;
    H !== void 0 && (w[F] = H);
  }
  const x = (F) => F in w ? w[F] : t.transitions?.[F], S = i || un(h, a), O = ut(
    () => t.children?.map((F, V) => /* @__PURE__ */ d(
      Ht,
      {
        node: F,
        store: e,
        renderBlurInsideShape: S
      },
      F.id ?? V
    )),
    [t.children, e, S]
  ), z = !n && h.mask !== void 0 && typeof h.blendMode == "string" && tt(h.blendMode) !== void 0, j = t.kind === "shape" && un(h, a) && tt(h.blendMode) === "plus-lighter", D = t.kind === "frame" && (typeof h.universal_opacity == "number" || typeof h.blur == "number" || typeof h.staticBlurPasses == "number" || typeof h.backdropBlur == "number" || typeof h.noise == "object" && h.noise !== null || typeof h.texture == "object" && h.texture !== null || typeof h.glass == "object" && h.glass !== null || h.sizing !== void 0 || typeof h.blendMode == "string" && !z), P = {
    visible: typeof h.visible == "boolean" ? h.visible : void 0,
    opacity: typeof h.universal_opacity == "number" ? h.universal_opacity : void 0,
    // A frame applies its own static rotation (frame.tsx) so it pivots around
    // its centre ; the wrapper has no box for a self-positioning frame and would
    // pivot around a collapsed (0-height) box. Non-frames keep it on the wrapper
    // (they DO carry position/size there).
    rotation: t.kind === "frame" ? void 0 : typeof h.rotation == "number" ? h.rotation : void 0,
    // Mirror (Figma scaleY(-1)) — like rotation, a frame mirrors itself
    // (frame.tsx) ; non-frames carry it on the wrapper, composed with rotation.
    flipY: t.kind === "frame" ? void 0 : h.flipY === !0,
    blur: t.kind === "shape" && (i || j) ? void 0 : typeof h.blur == "number" ? h.blur : void 0,
    staticBlurPasses: t.kind === "shape" && (i || j) ? void 0 : typeof h.staticBlurPasses == "number" ? h.staticBlurPasses : void 0,
    // ADR 014 Tier B (issue #355) — backdropBlur/noise/texture/glass are
    // consumed by the wrapper (CSS backdrop-filter / EffectOverlays), same
    // shape-narrowing rigor as `mask` below (full field validation lives in
    // the wrapper/EffectOverlays' own clamps, R8 — a malformed object here
    // degrades to "no effect", never an unbounded value reaching CSS).
    backdropBlur: typeof h.backdropBlur == "number" ? h.backdropBlur : void 0,
    noise: typeof h.noise == "object" && h.noise !== null ? h.noise : void 0,
    texture: typeof h.texture == "object" && h.texture !== null ? h.texture : void 0,
    glass: typeof h.glass == "object" && h.glass !== null ? h.glass : void 0,
    sizing: mo(h.sizing),
    position: t.kind === "frame" && !D ? void 0 : go(h),
    size: t.kind === "frame" && !D ? void 0 : fn(h),
    // ADR 002 §3.2 (D2 / #D) — `blendMode` is a universal prop on every
    // primitive ; the wrapper re-validates it against the closed enum
    // before applying `mix-blend-mode` (T4 runtime gate). Pass the raw
    // resolved value through ; the wrapper omits anything off the enum.
    // A blend on a MASKED node is hoisted ABOVE the mask wrapper (see below) —
    // a CSS mask forms an isolating group, so a `mix-blend-mode` left on the
    // (inner) wrapper would fold over a transparent backdrop (the caramel
    // hard-light showed the raw blue wave instead of compositing over the warm
    // gradient). Drop it here when it will be hoisted.
    blendMode: !n && typeof h.blendMode == "string" && !z ? h.blendMode : void 0
  }, X = Object.keys(r.colorProps).length > 0 ? { ...h, ...r.colorProps } : h, R = D ? { ...X, x: 0, y: 0 } : X;
  let M = null, I = null;
  if (h.mask !== void 0) {
    const F = (H, A) => {
      const _ = a.get(H);
      return _ ? _.kind === "frame" ? _ === g && T !== void 0 ? T : Ue(
        _,
        _.id,
        yt,
        void 0,
        !1,
        (lt) => bo(lt, e, o),
        s,
        c
      ) : sr(_, _.id, A) : null;
    };
    let V = !1;
    if (b) {
      const H = b.source;
      if ((H.kind === "group" || H.kind === "shape") && typeof H.ref == "string") {
        const A = a.get(H.ref), _ = H.kind === "group" && A === g ? $ : void 0;
        V = _ !== void 0 ? _.feather : A ? le(A, yt, !1) : !1, !V && H.kind === "group" && b.type === "alpha" && b.op === "intersect" && (I = _ !== void 0 ? _.simpleRoundedMaskRadius : A ? He(A) : null);
      }
    }
    M = b ? eo(
      b,
      s,
      t.id,
      F,
      fn(h),
      V,
      h,
      c
    ) : null;
  }
  if (M && I !== null) {
    const F = { ...M.style };
    delete F.mask, delete F.WebkitMask, M = {
      ...M,
      style: { ...F, borderRadius: I }
    };
  }
  const N = M !== null && M.style != null && "maskImage" in M.style, U = j ? be(
    typeof h.blur == "number" ? h.blur : void 0,
    typeof h.staticBlurPasses == "number" ? h.staticBlurPasses : void 0
  ) : void 0, L = M !== null && !N ? ho(t, h, a) : null;
  let B = /* @__PURE__ */ d(
    v,
    {
      resolved: R,
      nodeId: t.id,
      transitionFor: x,
      animateInitial: t.animate_initial,
      staticRender: ln(t),
      keyframed: t.keyframes !== void 0,
      establishesContainingBlock: k,
      renderBlurInsideShape: i,
      children: O
    }
  );
  M && N && (B = /* @__PURE__ */ d("div", { style: { width: "100%", height: "100%", ...M.style }, children: B }));
  let W = /* @__PURE__ */ d(Xe, { ...P, children: B });
  if (L !== null && M !== null) {
    const F = L.map((V, H) => {
      const A = V.nodes.map((at, lt) => /* @__PURE__ */ d(
        Ht,
        {
          node: at,
          store: e,
          suppressBlendMode: !0
        },
        at.id ?? `${H}-${lt}`
      )), _ = /* @__PURE__ */ d(
        v,
        {
          resolved: R,
          nodeId: t.id,
          transitionFor: x,
          animateInitial: t.animate_initial,
          staticRender: ln(t),
          keyframed: t.keyframes !== void 0,
          establishesContainingBlock: k,
          renderBlurInsideShape: i,
          children: A
        }
      );
      return /* @__PURE__ */ d(
        po,
        {
          built: M,
          blendMode: V.blendMode,
          children: /* @__PURE__ */ d(Xe, { ...P, children: _ })
        },
        `${t.id ?? "anonymous"}-mask-blend-${H}`
      );
    });
    W = /* @__PURE__ */ d(et, { children: F });
  }
  if (M && !N && L === null) {
    const F = M.feather ? Ut : 0;
    W = /* @__PURE__ */ C(
      "div",
      {
        style: {
          position: "absolute",
          inset: -F,
          overflow: "hidden",
          ...U !== void 0 ? { filter: U } : {},
          ...M.style
        },
        children: [
          /* @__PURE__ */ d("svg", { width: 0, height: 0, style: { position: "absolute" }, "aria-hidden": !0, children: /* @__PURE__ */ d("defs", { children: M.def }) }),
          /* @__PURE__ */ d("div", { style: { position: "absolute", inset: F }, children: W })
        ]
      }
    );
  }
  if (M && z) {
    const F = tt(h.blendMode);
    W = /* @__PURE__ */ d(
      "div",
      {
        style: {
          position: "absolute",
          inset: 0,
          mixBlendMode: F
        },
        children: W
      }
    );
  }
  return r.motionStyle && (W = /* @__PURE__ */ d(
    xt.div,
    {
      ref: r.motionRef,
      "data-lumencast-bind-animate": t.id ?? "",
      style: r.motionStyle,
      children: W
    }
  )), t.keyframes ? /* @__PURE__ */ d(Lr, { keyframes: t.keyframes, store: e, nodeId: t.id, children: W }) : W;
}
function fo(t, e, n) {
  if (t.kind !== "frame") return null;
  const i = (t.children ?? []).filter((a) => a.props?.visible !== !1);
  if (i.length < 2 || i.some((a) => !On(a))) return null;
  const r = An(e.mask, t.id);
  if (r === null || r.type !== "alpha" || r.op !== "intersect" || r.source.kind !== "shape") return null;
  const o = n.get(r.source.ref);
  if (!En(o)) return null;
  const s = tt(e.blendMode);
  if (s !== void 0 && s !== "normal" || typeof e.opacity == "number" && e.opacity !== 1 || typeof e.universal_opacity == "number" && e.universal_opacity !== 1)
    return null;
  const c = [];
  for (const a of i) {
    const l = tt(a.props?.blendMode), u = l !== void 0 && l !== "normal" ? l : void 0, f = c.at(-1);
    u !== void 0 ? c.push({ nodes: [a], blendMode: u }) : f !== void 0 && f.blendMode === void 0 ? f.nodes.push(a) : c.push({ nodes: [a], blendMode: u });
  }
  return c.some((a) => a.blendMode !== void 0) ? c : null;
}
const cn = /* @__PURE__ */ new WeakMap();
function ho(t, e, n) {
  const i = cn.get(t);
  if (i !== void 0 && i.mask === e.mask && i.blendMode === e.blendMode && i.opacity === e.opacity && i.universalOpacity === e.universal_opacity && i.shapeIndex === n)
    return i.value;
  const r = fo(t, e, n);
  return cn.set(t, {
    mask: e.mask,
    blendMode: e.blendMode,
    opacity: e.opacity,
    universalOpacity: e.universal_opacity,
    shapeIndex: n,
    value: r
  }), r;
}
function En(t) {
  if (t?.kind !== "shape") return !1;
  const e = t.props ?? {};
  return !(!(typeof e.stroke == "string" && e.stroke !== "none" && e.stroke !== "transparent" || typeof e.stroke == "object" && e.stroke !== null && typeof e.stroke.color == "string") || typeof e.fill == "string" && e.fill !== "none" && e.fill !== "transparent" || Array.isArray(e.fills) && e.fills.some((i) => i != null));
}
function un(t, e) {
  const n = t.mask;
  if (typeof n != "object" || n === null) return !1;
  const i = n.source;
  if (typeof i != "object" || i === null) return !1;
  const r = i;
  if (r.kind !== "shape" || typeof r.ref != "string") return !1;
  const o = n;
  return o.type !== "alpha" || o.op !== "intersect" ? !1 : En(e.get(r.ref));
}
function po({
  built: t,
  blendMode: e,
  children: n
}) {
  const i = t.feather ? Ut : 0, r = /* @__PURE__ */ C(
    "div",
    {
      style: {
        position: "absolute",
        inset: -i,
        overflow: "hidden",
        ...t.style
      },
      children: [
        /* @__PURE__ */ d("svg", { width: 0, height: 0, style: { position: "absolute" }, "aria-hidden": !0, children: /* @__PURE__ */ d("defs", { children: t.def }) }),
        /* @__PURE__ */ d("div", { style: { position: "absolute", inset: i }, children: n })
      ]
    }
  );
  return e === void 0 ? r : /* @__PURE__ */ d(
    "div",
    {
      style: {
        position: "absolute",
        inset: 0,
        ...e === void 0 ? {} : { mixBlendMode: e }
      },
      children: r
    }
  );
}
function mo(t) {
  if (typeof t != "object" || t === null) return;
  const e = t, n = {};
  return (e.x === "fixed" || e.x === "hug" || e.x === "fill") && (n.x = e.x), (e.y === "fixed" || e.y === "hug" || e.y === "fill") && (n.y = e.y), n.x !== void 0 || n.y !== void 0 ? n : void 0;
}
function nt(t) {
  return typeof t == "number" && Number.isFinite(t) ? t : void 0;
}
function go(t) {
  let e = nt(t.x), n = nt(t.y);
  if (e === void 0 && n === void 0) {
    const i = t.position;
    i && typeof i == "object" && (e = nt(i.x), n = nt(i.y));
  }
  if (!(e === void 0 || n === void 0))
    return { x: e, y: n };
}
function fn(t) {
  let e = nt(t.width), n = nt(t.height);
  if (e === void 0 && n === void 0) {
    const i = t.size;
    i && typeof i == "object" && (e = nt(i.w), n = nt(i.h));
  }
  if (!(e === void 0 && n === void 0))
    return { w: e, h: n };
}
function On(t) {
  if (t.kind === "frame") return !1;
  const e = t.props ?? {}, n = t.bindings ?? {}, i = e.position, r = nt(e.x) !== void 0 || "x" in n || (i ? nt(i.x) !== void 0 : !1), o = nt(e.y) !== void 0 || "y" in n || (i ? nt(i.y) !== void 0 : !1);
  return r && o;
}
function yo({ node: t, store: e }) {
  fe();
  const n = qt();
  pn(t);
  const i = t.bindings?.items, r = i === void 0 ? [] : e.signal(Rt(n, i)).value ?? [];
  if (!Array.isArray(r)) return null;
  const o = t.children?.[0];
  if (!o) return null;
  const s = typeof t.stagger_ms == "number" ? t.stagger_ms : 0;
  return /* @__PURE__ */ d(et, { children: r.map((c, a) => {
    const l = Pr(a, s), u = /* @__PURE__ */ d(_r, { prefix: `${i ?? ""}.${a}`, children: /* @__PURE__ */ d(Ht, { node: o, store: e }) }, a);
    return l <= 0 ? u : /* @__PURE__ */ d(ke.Provider, { value: l, children: u }, a);
  }) });
}
function bo(t, e, n) {
  const i = Kt(t);
  if (i.length === 0) return ue(t, i, Nn);
  const o = i.map(([, s]) => Rt(n, s)).map((s) => e.signal(s));
  return ue(t, i, _n(o));
}
function ue(t, e, n) {
  const i = { ...t.props ?? {} };
  for (let r = 0; r < e.length; r += 1) {
    const [o] = e[r], s = n[r];
    o === "colour" && s == null || (i[o] = s);
  }
  return i;
}
function _n(t) {
  if (t.length === 0) return Nn;
  const e = new Array(t.length);
  for (let n = 0; n < t.length; n += 1)
    e[n] = t[n].value;
  return e;
}
export {
  Ro as S,
  Ht as T,
  Ao as b
};
//# sourceMappingURL=tree-AMqu7A5c.js.map
