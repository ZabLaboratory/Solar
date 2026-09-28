import { batch as x, signal as b } from "@preact/signals-react";
import { createRoot as de } from "react-dom/client";
import { flushSync as be } from "react-dom";
import { createContext as B, useContext as D, lazy as H, Suspense as ke, useLayoutEffect as _e, createElement as Ee, StrictMode as Te } from "react";
import { jsx as h, jsxs as Re } from "react/jsx-runtime";
import { useSignals as Ie } from "@preact/signals-react/runtime";
import { AnimatePresence as Ae, motion as Pe } from "framer-motion";
import { SequenceTracker as Me, encodeFrame as V, input as Oe, WS_SUBPROTOCOLS as Le, WS_SUBPROTOCOL_V1_1 as Ce, subscribe as xe, decodeServerFrame as Ne, LumencastError as Y, checkHostAllowed as De, isHostAllowed as je } from "@lumencast/protocol";
const q = B(null);
function fe({
  value: e,
  children: t
}) {
  return /* @__PURE__ */ h(q.Provider, { value: e, children: t });
}
function qt() {
  const e = D(q);
  if (!e)
    throw new Error(
      "Lumencast overlay components must be rendered inside LumencastRuntimeProvider"
    );
  return e;
}
function Xt() {
  return D(q);
}
const Fe = H(
  () => import("./broadcast--VSPjpD_.js").then((e) => ({ default: e.BroadcastMode }))
), Ue = H(
  () => import("./control-D67rAkYa.js").then((e) => ({ default: e.ControlMode }))
), $e = H(() => import("./test-YJAdoshm.js").then((e) => ({ default: e.TestMode })));
function We({
  scene: e,
  notify: t
}) {
  return _e(() => {
    e && t?.(e);
  }, [e, t]), null;
}
function ze({
  mode: e,
  store: t,
  previewStoreSignal: s,
  bundleSignal: n,
  statusSignal: r,
  crossfadeKeySignal: i,
  sendInput: o,
  isHostAssetUrl: a,
  resolveCaptureDevice: c,
  resolvePeerStream: l,
  subscribePeerStream: u,
  liveAudio: m,
  realtimeDeltas: k,
  sceneTransition: f,
  commitSignal: T,
  onSceneCommit: R
}) {
  Ie();
  const I = n.value, j = r.value, w = i.value, A = T?.value ?? null, P = s?.value ?? t;
  if (!I) return null;
  const F = e === "broadcast" ? Fe : e === "control" ? Ue : $e, d = /* @__PURE__ */ h(
    fe,
    {
      value: {
        mode: e,
        store: P,
        bundle: I,
        status: j,
        sendInput: o,
        ...a !== void 0 ? { isHostAssetUrl: a } : {},
        ...c !== void 0 ? { resolveCaptureDevice: c } : {},
        ...l !== void 0 ? { resolvePeerStream: l } : {},
        ...u !== void 0 ? { subscribePeerStream: u } : {},
        ...m !== void 0 ? { liveAudio: m } : {},
        ...k !== void 0 ? { realtimeDeltas: k } : {}
      },
      children: /* @__PURE__ */ Re(ke, { fallback: null, children: [
        /* @__PURE__ */ h(F, {}),
        /* @__PURE__ */ h(We, { scene: A, notify: R })
      ] })
    }
  );
  return f === "cut" ? /* @__PURE__ */ h("div", { style: { position: "absolute", inset: 0 }, children: d }, w) : /* @__PURE__ */ h(Ae, { mode: "sync", children: /* @__PURE__ */ h(
    Pe.div,
    {
      initial: { opacity: 0 },
      animate: { opacity: 1 },
      exit: { opacity: 0 },
      transition: { duration: 0.4, ease: "easeInOut" },
      style: { position: "absolute", inset: 0 },
      children: d
    },
    w
  ) });
}
const Be = "<anon>", N = /* @__PURE__ */ new Set();
function he(e) {
  return N.add(e), () => {
    N.delete(e);
  };
}
function X(e, t, s) {
  const n = { nodeId: e ?? Be, field: t, reason: s };
  if (N.size > 0) {
    for (const r of N)
      try {
        r(n);
      } catch {
      }
    return;
  }
}
const J = 400, He = 7, qe = 4, Xe = 64, Ge = 1e3, Ke = 4096, Ve = 2e3, Ye = {
  blur: J,
  brightness: qe,
  backdropBlur: J,
  noiseSize: Ve
};
function Z(e, t) {
  if (typeof t != "number" || !Number.isFinite(t) || t < 0 || Object.is(t, -0)) return null;
  const s = Ye[e];
  return t > s ? s : t;
}
function Gt(e) {
  return typeof e != "number" || !Number.isFinite(e) || e < 1 ? null : Math.min(He, Math.floor(e));
}
const Je = {
  shadowSpread: Ge,
  shadowOffset: Ke
};
function Kt(e, t) {
  if (typeof t != "number" || !Number.isFinite(t)) return null;
  const s = Je[e];
  return t > s ? s : t < -s ? -s : t;
}
function Vt(e) {
  return typeof e != "number" || !Number.isFinite(e) ? null : e < 0 ? 0 : e > 1 ? 1 : e;
}
function Yt(e) {
  return typeof e != "number" || !Number.isFinite(e) ? 0 : (e % 360 + 360) % 360;
}
const Ze = /^blur\((\d{1,7}(?:\.\d{1,4})?)px\) brightness\((\d{1,7}(?:\.\d{1,4})?)\)$/, Jt = "blur(0px) brightness(1)";
function Qe(e) {
  if (typeof e != "string" || e.length === 0 || e.length > Xe) return null;
  const t = Ze.exec(e);
  if (!t) return null;
  const s = Z("blur", Number(t[1])), n = Z("brightness", Number(t[2]));
  return s === null || n === null ? null : `blur(${s}px) brightness(${n})`;
}
function et(e, t) {
  X(
    t,
    e,
    "rejected unsafe filter value : outside the R8 caps or not a finite number >= 0"
  );
}
const tt = { duration: 0 }, st = {
  linear: "linear",
  "cubic-in": "easeIn",
  "cubic-out": "easeOut",
  "cubic-in-out": "easeInOut"
};
function Zt(e) {
  return !e || e.kind === "none" ? tt : e.kind === "tween" ? {
    type: "tween",
    duration: (e.duration_ms ?? 0) / 1e3,
    ease: e.ease ? st[e.ease] ?? "easeOut" : "easeOut"
  } : e.kind === "spring" ? {
    type: "spring",
    ...e.stiffness !== void 0 ? { stiffness: e.stiffness } : {},
    ...e.damping !== void 0 ? { damping: e.damping } : {},
    ...e.mass !== void 0 ? { mass: e.mass } : {}
  } : {
    type: "tween",
    duration: (e.duration_ms ?? 400) / 1e3,
    ease: "easeInOut"
  };
}
const nt = {
  opacity: 1,
  scale: 1,
  scaleX: 1,
  scaleY: 1,
  rotate: 0,
  x: 0,
  y: 0,
  // LSML §6.1 filter identity — both functions are always present so
  // framer interpolates between structurally-identical filter lists
  // (the compiler emits the same two-function form, clamped per R8).
  filter: "blur(0px) brightness(1)"
}, rt = {
  kind: "tween",
  duration_ms: 400,
  ease: "cubic-out"
};
function Qt(e, t, s) {
  for (const n of t) {
    const r = e(n);
    if (r !== void 0) return r;
  }
  if (s && Object.keys(s).length > 0) {
    for (const n of Object.keys(s)) {
      const r = e(n);
      if (r !== void 0) return r;
    }
    return rt;
  }
}
function es(e, t, s) {
  if (!t || Object.keys(t).length === 0)
    return { initial: e, animate: e };
  let n = t;
  if (t.filter !== void 0) {
    const i = Qe(t.filter);
    n = { ...t }, i === null ? (et("animate_initial.filter", s), delete n.filter) : n.filter = i;
  }
  const r = { ...e };
  for (const i of Object.keys(n))
    i in r || (r[i] = nt[i] ?? 0);
  return { initial: n, animate: r };
}
function it(e) {
  if (typeof e != "object" || e === null) return;
  const t = e, s = t.kind;
  if (s === "snap")
    return { kind: "none" };
  if (s === "tween") {
    const n = typeof t.duration_ms == "number" ? t.duration_ms : 0, r = ot[t.easing] ?? "cubic-out";
    return { kind: "tween", duration_ms: n, ease: r };
  }
  if (s === "spring") {
    const n = { kind: "spring" };
    return typeof t.stiffness == "number" && (n.stiffness = t.stiffness), typeof t.damping == "number" && (n.damping = t.damping), typeof t.mass == "number" && (n.mass = t.mass), n;
  }
}
const ot = {
  linear: "linear",
  "ease-in": "cubic-in",
  "ease-out": "cubic-out",
  "ease-in-out": "cubic-in-out"
};
function Q(e, t) {
  x(() => {
    for (const s of t.patches) {
      const n = it(s.transition);
      n !== void 0 ? e.setWithTransition(s.path, s.value, n) : e.set(s.path, s.value);
    }
  });
}
function at(e, t) {
  e.reset(t.state);
}
const ts = "__cam.", z = "__cam.slots.", me = "__cam.viewer";
function ee(e) {
  return e === me || e.startsWith(z);
}
function ct(e) {
  const t = {};
  let s;
  for (const [n, r] of e)
    if (n === me)
      r != null && (s = r);
    else if (n.startsWith(z)) {
      const i = n.slice(z.length);
      i !== "" && typeof r == "string" && r !== "" && (t[i] = r);
    }
  return s !== void 0 ? { viewer: s, slots: t } : { slots: t };
}
function te(e) {
  const t = Object.keys(e.slots).sort().map((n) => `${n}=${e.slots[n]}`).join("&"), s = e.viewer === void 0 ? "" : JSON.stringify(e.viewer);
  return `${t}|${s}`;
}
function lt(e) {
  const t = /* @__PURE__ */ new Map();
  let s = te({ slots: {} });
  const n = () => {
    const r = ct(t), i = te(r);
    i !== s && (s = i, e(r));
  };
  return {
    onSnapshot(r) {
      t.clear();
      for (const [i, o] of Object.entries(r))
        ee(i) && t.set(i, o);
      n();
    },
    onDelta(r) {
      let i = !1;
      for (const o of r)
        ee(o.path) && (t.set(o.path, o.value), i = !0);
      i && n();
    }
  };
}
class ut {
  signals = /* @__PURE__ */ new Map();
  transitions = /* @__PURE__ */ new Map();
  signal(t) {
    let s = this.signals.get(t);
    return s || (s = b(void 0), this.signals.set(t, s)), s;
  }
  transitionSignal(t) {
    let s = this.transitions.get(t);
    return s || (s = b(void 0), this.transitions.set(t, s)), s;
  }
  set(t, s) {
    const n = this.signal(t);
    W(n.peek(), s) || (n.value = s);
  }
  setWithTransition(t, s, n) {
    x(() => {
      const r = this.transitionSignal(t);
      r.peek() !== n && (r.value = n);
      const i = this.signal(t);
      W(i.peek(), s) || (i.value = s);
    });
  }
  reset(t) {
    x(() => {
      const s = /* @__PURE__ */ new Set();
      for (const [n, r] of Object.entries(t)) {
        s.add(n);
        const i = this.signal(n);
        W(i.peek(), r) || (i.value = r);
        const o = this.transitions.get(n);
        o && o.peek() !== void 0 && (o.value = void 0);
      }
      for (const n of this.signals.keys())
        if (!s.has(n)) {
          const r = this.signals.get(n);
          r && r.peek() !== void 0 && (r.value = void 0);
        }
    });
  }
  toRecord() {
    const t = {};
    for (const [s, n] of this.signals.entries())
      t[s] = n.peek();
    return t;
  }
}
function C() {
  return new ut();
}
function W(e, t) {
  if (e === t) return !0;
  if (e === null || t === null || typeof e != typeof t || typeof e != "object" || Array.isArray(e) !== Array.isArray(t)) return !1;
  if (Array.isArray(e) && Array.isArray(t)) {
    if (e.length !== t.length) return !1;
    for (let o = 0; o < e.length; o++)
      if (e[o] !== t[o]) return !1;
    return !0;
  }
  const s = e, n = t, r = Object.keys(s), i = Object.keys(n);
  if (r.length !== i.length) return !1;
  for (const o of r)
    if (s[o] !== n[o]) return !1;
  return !0;
}
const dt = /* @__PURE__ */ new Set([
  "x-lumencast.color-srgb-1.0",
  // RFC-0001 / ADR 004 — this runtime ships the Zab capture plugin, so a
  // bundle declaring `x-zab.capture/1` in `profiles[]` is compatible (it is
  // NOT rejected as BUNDLE_INCOMPATIBLE, §17.3.1).
  "x-zab.capture/1"
]), ft = /^x-[a-z0-9-]+(?:\.[a-z0-9-]+)*$/, ht = /^(?:0|[1-9][0-9]*)$/, se = ".authoring";
function mt(e) {
  const t = e.indexOf("/");
  if (t < 0) return !1;
  const s = e.slice(0, t), n = e.slice(t + 1);
  return !ht.test(n) || !s.endsWith(se) ? !1 : ft.test(s.slice(0, -se.length));
}
class ne extends Error {
  code = "BUNDLE_INCOMPATIBLE";
  unsupportedProfiles;
  constructor(t) {
    super(
      `BUNDLE_INCOMPATIBLE: profile(s) not supported by this runtime: ${t.join(
        ", "
      )}`
    ), this.name = "BundleIncompatibleError", this.unsupportedProfiles = t;
  }
}
function re(e, t = dt) {
  const s = e.profiles;
  if (!s) return;
  if (!Array.isArray(s))
    throw new ne(["<malformed: profiles is not an array>"]);
  if (s.length === 0) return;
  const n = s.filter((r) => typeof r != "string" || !mt(r) && !t.has(r)).map((r) => typeof r == "string" ? r : "<malformed: non-string profile entry>");
  if (n.length > 0)
    throw new ne(n);
}
class pt {
  cache = /* @__PURE__ */ new Map();
  inFlight = /* @__PURE__ */ new Map();
  baseUrl;
  pathPrefix;
  resolveUrl;
  getAuthToken;
  fetchImpl;
  constructor(t) {
    this.baseUrl = t.baseUrl.replace(/\/$/, ""), this.pathPrefix = (t.pathPrefix ?? "/lsdp/v1/scenes").replace(/\/$/, ""), this.resolveUrl = t.resolveUrl, this.getAuthToken = t.getAuthToken, this.fetchImpl = t.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }
  /** Build the request init carrying the bearer token, if any. Returns
   *  `undefined` when no token is available — the fetch stays header-less,
   *  preserving v0.5.0 behaviour. */
  async buildInit() {
    if (!this.getAuthToken) return;
    const t = await this.getAuthToken();
    if (t)
      return { headers: { Authorization: `Bearer ${t}` } };
  }
  buildUrl(t, s) {
    return this.resolveUrl ? this.resolveUrl(t, s) : `${this.baseUrl}${this.pathPrefix}/${encodeURIComponent(t)}/bundle?v=${encodeURIComponent(s)}`;
  }
  preload(t) {
    re(t), this.cache.set(t.scene_version, t);
  }
  async get(t, s) {
    const n = this.cache.get(s);
    if (n) return n;
    const r = this.inFlight.get(s);
    if (r) return r;
    const i = this.fetchBundle(t, s).finally(() => {
      this.inFlight.delete(s);
    });
    return this.inFlight.set(s, i), i;
  }
  async fetchBundle(t, s) {
    const n = this.buildUrl(t, s), r = await this.buildInit(), i = r ? await this.fetchImpl(n, r) : await this.fetchImpl(n);
    if (!i.ok)
      throw new Error(`bundle fetch failed: ${i.status} ${i.statusText}`);
    const o = await i.json();
    if (o.scene_version !== s)
      throw new Error(
        `bundle scene_version mismatch: expected ${s}, got ${o.scene_version}`
      );
    return re(o), this.cache.set(s, o), o;
  }
}
function gt(e) {
  return new pt(e);
}
const L = {
  initial: 200,
  max: 5e3,
  factor: 2,
  jitter: 0.2
};
class vt {
  constructor(t, s) {
    this.opts = t, this.random = s;
  }
  _attempt = 0;
  get attempt() {
    return this._attempt;
  }
  delayFor(t) {
    if (!Number.isInteger(t) || t < 1)
      throw new RangeError(`attempt must be a positive integer, got ${t}`);
    this._attempt = t;
    const s = Math.min(
      this.opts.initial * Math.pow(this.opts.factor, t - 1),
      this.opts.max
    );
    if (this.opts.jitter <= 0) return s;
    const n = (this.random() * 2 - 1) * this.opts.jitter * s;
    return Math.max(0, s + n);
  }
  reset() {
    this._attempt = 0;
  }
}
function wt(e = {}) {
  const t = {
    initial: e.initial ?? L.initial,
    max: e.max ?? L.max,
    factor: e.factor ?? L.factor,
    jitter: e.jitter ?? L.jitter
  };
  if (t.initial <= 0) throw new RangeError("initial must be > 0");
  if (t.max < t.initial) throw new RangeError("max must be >= initial");
  if (t.factor < 1) throw new RangeError("factor must be >= 1");
  if (t.jitter < 0 || t.jitter > 1) throw new RangeError("jitter must be within [0, 1]");
  return new vt(t, e.random ?? Math.random);
}
class _ extends Error {
  recoverable;
  code;
  cause;
  constructor(t, s, n = "INTERNAL", r) {
    super(t), this.name = "TransportError", this.recoverable = s, this.code = n, this.cause = r;
  }
}
class yt {
  status = "disconnected";
  socket = null;
  token;
  url;
  WebSocketCtor;
  schedule;
  seq = new Me();
  opts;
  scheduler;
  reconnectTimer = null;
  active = !0;
  constructor(t) {
    this.opts = t, this.url = t.url, this.token = t.token;
    const s = t.webSocketImpl ?? globalThis.WebSocket;
    if (!s)
      throw new TypeError(
        "Lumencast WsClient: no WebSocket implementation found in this environment"
      );
    this.WebSocketCtor = s, this.schedule = wt(t.reconnect), this.scheduler = t.scheduler ?? {
      setTimeout: globalThis.setTimeout.bind(globalThis),
      clearTimeout: globalThis.clearTimeout.bind(globalThis)
    };
  }
  /** Open and start the connection lifecycle. Idempotent. */
  start() {
    this.active && (this.socket || this.status === "connecting" || this.openSocket());
  }
  /** Resolve the current session token (the one used for the WS
   *  subscription). Mirrors `setToken` swaps. Used by the bundle fetcher to
   *  authenticate the render-bundle GET with the same credential. A
   *  `LumencastTokenProvider` is awaited. */
  resolveCurrentToken() {
    return ie(this.token);
  }
  /** Send `input` patches to the server. No-op if not connected. */
  sendInput(t) {
    !this.socket || this.socket.readyState !== this.WebSocketCtor.OPEN || t.length !== 0 && this.socket.send(V(Oe(t)));
  }
  /** Replace the auth token. Closes and reopens with the new token. */
  setToken(t) {
    this.token = t, this.active && this.socket && (this.closeSocket(), this.scheduleReconnect(!0));
  }
  /** Tear down for good. No more reconnect attempts. */
  close() {
    this.active && (this.active = !1, this.cancelReconnect(), this.closeSocket(), this.setStatus("disconnected"));
  }
  // --- internals --------------------------------------------------
  async openSocket() {
    if (!this.active) return;
    this.setStatus("connecting");
    let t;
    try {
      t = await ie(this.token);
    } catch (n) {
      this.opts.onTransportError?.(
        new _(
          `failed to resolve token: ${n.message}`,
          !0,
          "AUTH_DENIED",
          n
        )
      ), this.scheduleReconnect();
      return;
    }
    if (!this.active) return;
    let s;
    try {
      s = new this.WebSocketCtor(this.url, [...Le]);
    } catch (n) {
      this.opts.onTransportError?.(
        new _(
          `failed to open WebSocket: ${n.message}`,
          !0,
          "INTERNAL",
          n
        )
      ), this.scheduleReconnect();
      return;
    }
    this.socket = s, s.onopen = () => this.handleOpen(t), s.onmessage = (n) => this.handleMessage(n), s.onerror = (n) => this.handleError(n), s.onclose = (n) => this.handleClose(n);
  }
  handleOpen(t) {
    if (!this.socket) return;
    const n = this.socket.protocol === Ce && this.seq.last > 0, r = n ? this.seq.last : void 0;
    n || this.seq.reset();
    const i = xe({
      token: t,
      ...this.opts.scene !== void 0 ? { scene: this.opts.scene } : {},
      ...this.opts.session !== void 0 ? { session: this.opts.session } : {},
      ...r !== void 0 ? { since_sequence: r } : {}
    });
    this.socket.send(V(i));
  }
  handleMessage(t) {
    const s = typeof t.data == "string" ? t.data : "";
    if (!s) return;
    let n;
    try {
      n = Ne(s);
    } catch (r) {
      const i = (r instanceof Y, r.message), o = r instanceof Y ? r.code : "INTERNAL";
      this.opts.onTransportError?.(new _(`codec: ${i}`, !0, o, r)), this.closeSocket(), this.scheduleReconnect();
      return;
    }
    if (n !== null)
      switch (n.type) {
        case "snapshot": {
          if (n.seq < 1) {
            this.opts.onTransportError?.(
              new _(`snapshot seq must be >= 1, got ${n.seq}`, !0, "VERSION_GAP")
            ), this.closeSocket(), this.scheduleReconnect();
            return;
          }
          this.seq.observeSnapshot(n.seq), this.schedule.reset(), this.setStatus("live"), this.opts.onSnapshot?.(n);
          return;
        }
        case "delta": {
          const r = this.seq.observe(n.seq);
          if (r.kind === "gap") {
            this.opts.onTransportError?.(
              new _(
                `sequence gap: expected ${this.seq.last + 1}, got ${n.seq}`,
                !0,
                "VERSION_GAP"
              )
            ), this.closeSocket(), this.scheduleReconnect();
            return;
          }
          if (r.kind === "duplicate") return;
          this.opts.onDelta?.(n);
          return;
        }
        case "scene_changed": {
          this.seq.reset(), this.opts.onSceneChanged?.(n);
          return;
        }
        case "error": {
          this.opts.onServerError?.(n), n.recoverable || this.close();
          return;
        }
        case "scene_roster": {
          this.opts.onSceneRoster?.(n);
          return;
        }
        case "pong":
          return;
      }
  }
  handleError(t) {
  }
  handleClose(t) {
    if (this.socket = null, !this.active) {
      this.setStatus("disconnected");
      return;
    }
    if (t.code === 4401 || t.code === 4403 || t.code === 1008) {
      this.opts.onTransportError?.(
        new _(`server closed: ${t.code} ${t.reason}`, !1, "AUTH_DENIED")
      ), this.close();
      return;
    }
    this.scheduleReconnect();
  }
  scheduleReconnect(t = !1) {
    if (!this.active) return;
    this.cancelReconnect();
    const s = (this.schedule.attempt || 0) + 1, n = t ? 0 : this.schedule.delayFor(s);
    this.setStatus("disconnected"), this.reconnectTimer = this.scheduler.setTimeout(() => {
      this.reconnectTimer = null, this.openSocket();
    }, n);
  }
  cancelReconnect() {
    this.reconnectTimer && (this.scheduler.clearTimeout(this.reconnectTimer), this.reconnectTimer = null);
  }
  closeSocket() {
    if (this.socket) {
      try {
        this.socket.close(1e3, "client closing");
      } catch {
      }
      this.socket = null;
    }
  }
  setStatus(t) {
    this.status !== t && (this.status = t, this.opts.onStatus?.(t));
  }
}
async function ie(e) {
  return typeof e == "string" ? e : await e.fetch();
}
function St(e) {
  if (!(e.target instanceof HTMLElement))
    throw new TypeError("mount: `target` must be an HTMLElement");
  if (typeof e.serverUrl != "string" || e.serverUrl.length === 0)
    throw new TypeError("mount: `serverUrl` must be a non-empty string");
  if (e.mode === "test") {
    if (!e.testSession)
      throw new TypeError("mount: `testSession` is required when mode === 'test'");
    if (!e.scene)
      throw new TypeError("mount: `scene` is required when mode === 'test'");
  }
}
const pe = B(void 0), ge = B(void 0);
function ss({
  hosts: e,
  isHostAssetUrl: t,
  children: s
}) {
  return /* @__PURE__ */ h(pe.Provider, { value: e, children: /* @__PURE__ */ h(ge.Provider, { value: t, children: s }) });
}
function ns() {
  return D(pe);
}
function rs() {
  return D(ge);
}
function bt(e) {
  const s = e.assets?.allowedHosts;
  if (!Array.isArray(s)) return;
  const n = s.filter((r) => typeof r == "string");
  return n.length > 0 ? n : void 0;
}
function is(e, t, s, n, r) {
  if (typeof e != "string" || e.length === 0) return;
  if (e.length <= 2048 && e.startsWith("blob:") && r?.(e) === !0) return e;
  const i = De(e, t);
  if (i.allowed) return e;
  X(n, s, i.reason ?? "asset host/scheme rejected");
}
const kt = 4096, oe = 4, _t = 12, Et = 12e6;
function Tt(e) {
  const t = bt(e), s = /* @__PURE__ */ new Set(), n = e.root && typeof e.root == "object" ? [e.root] : [];
  let r = 0;
  const i = (o) => {
    s.size >= oe || typeof o != "string" || !/^https:\/\//i.test(o) || !je(o, t) || s.add(o);
  };
  for (; n.length > 0 && r < kt && s.size < oe; ) {
    const o = n.pop();
    if (r += 1, !o || typeof o != "object") continue;
    const a = o.props;
    if (a) {
      o.kind === "image" && i(a.src);
      const c = o.kind === "shape" ? "fills" : o.kind === "frame" ? "backgrounds" : null;
      if (c && Array.isArray(a[c]))
        for (const u of a[c])
          u && typeof u == "object" && u.kind === "image" && i(u.src);
      const l = a.mask;
      if (l && typeof l == "object") {
        const u = l;
        (u.type === "alpha" || u.type === "luminance") && (u.op === "intersect" || u.op === "subtract" || u.op === "union") && u.source?.kind === "image" && i(u.source.src);
      }
    }
    if (Array.isArray(o.children))
      for (let c = o.children.length - 1; c >= 0; c -= 1) {
        const l = o.children[c];
        l && typeof l == "object" && n.push(l);
      }
  }
  return [...s];
}
function Rt() {
  const e = /* @__PURE__ */ new Map(), t = /* @__PURE__ */ new Map();
  let s = 0, n = !0;
  async function r(i) {
    if (e.has(i)) return !0;
    const o = t.get(i);
    if (o) return o;
    if (!n || e.size + t.size >= _t) return !1;
    const a = (async () => {
      try {
        const c = new Image();
        c.decoding = "async", typeof c.decode == "function" ? (c.src = i, await c.decode()) : await new Promise((u, m) => {
          c.onload = () => u(), c.onerror = () => m(new Error("image preload failed")), c.src = i;
        });
        const l = c.naturalWidth * c.naturalHeight;
        return !n || !Number.isFinite(l) || l <= 0 || l + s > Et ? !1 : (e.set(i, c), s += l, !0);
      } catch {
        return !1;
      }
    })();
    t.set(i, a);
    try {
      return await a;
    } finally {
      t.delete(i);
    }
  }
  return {
    async warm(i) {
      const o = Tt(i), c = (await Promise.all(o.map(r))).filter(Boolean).length;
      return { candidates: o.length, decoded: c, notReady: o.length - c };
    },
    clear() {
      n = !1, e.clear(), t.clear(), s = 0;
    }
  };
}
function It(e) {
  St(e), e.onStatus?.("disconnected");
  let t = C();
  const s = e.realtimeDeltas ? b(t) : void 0, n = Pt(e.serverUrl), r = gt({
    baseUrl: n,
    ...e.resolveBundleUrl !== void 0 ? { resolveUrl: e.resolveBundleUrl } : {},
    getAuthToken: () => w.resolveCurrentToken()
  }), i = b(null), o = b("disconnected"), a = b("__initial__"), c = b(null);
  let l = 0, u = null;
  const m = (d) => {
    o.value = d, e.onStatus?.(d);
  }, k = (d) => {
    e.onError?.(d);
  };
  let f = !0;
  const T = /* @__PURE__ */ new Set(), R = e.preloadRosterImages === !0 ? Rt() : null, I = e.onReservedLeaves ? lt(e.onReservedLeaves) : void 0, j = e.onDiagnostic ? he(e.onDiagnostic) : void 0, w = new yt({
    url: e.serverUrl,
    token: e.token,
    ...e.webSocketImpl !== void 0 ? { webSocketImpl: e.webSocketImpl } : {},
    ...e.scene !== void 0 ? { scene: e.scene } : {},
    ...e.testSession !== void 0 ? { session: e.testSession } : {},
    onStatus: m,
    onSnapshot: (d) => {
      if (!f) return;
      const y = ++l, S = C();
      at(S, d), u = S, F(
        r,
        i,
        a,
        d.scene_id,
        d.scene_version,
        () => {
          const v = S.toRecord();
          s && a.value !== `${d.scene_id}::${d.scene_version}` ? (t = S, s.value = t) : t.reset(v), I?.onSnapshot(v), u = null;
        },
        k,
        y
      ), e.onMetric?.({
        name: "snapshot_received",
        scene_id: d.scene_id,
        path_count: Object.keys(d.state).length
      });
    },
    onDelta: (d) => {
      if (!f) return;
      if (u) {
        Q(u, d);
        return;
      }
      const y = performance.now();
      Q(t, d), I?.onDelta(d.patches), e.onMetric?.({
        name: "delta_applied",
        duration_ms: performance.now() - y
      }), e.onMetric?.({ name: "delta_received", count: 1, path_count: d.patches.length });
    },
    onSceneChanged: (d) => {
      f && (++l, u = C(), e.onMetric?.({
        name: "scene_changed",
        from: i.value?.scene_version ?? null,
        to: d.scene_version
      }));
    },
    onSceneRoster: (d) => {
      f && P(d.entries, "frame");
    },
    onServerError: (d) => {
      k({
        code: d.code,
        message: d.message,
        recoverable: d.recoverable
      });
    },
    onTransportError: (d) => {
      k(At(d));
    }
  });
  w.start(), e.preloadRoster !== void 0 && e.preloadRoster.length > 0 && P(e.preloadRoster, "option");
  const A = de(e.target);
  return A.render(
    Ee(ze, {
      mode: e.mode,
      store: t,
      ...s ? { previewStoreSignal: s } : {},
      bundleSignal: i,
      statusSignal: o,
      crossfadeKeySignal: a,
      commitSignal: c,
      ...e.sceneTransition !== void 0 ? { sceneTransition: e.sceneTransition } : {},
      ...e.onSceneCommit !== void 0 ? { onSceneCommit: e.onSceneCommit } : {},
      sendInput: (d) => w.sendInput(d),
      ...e.isHostAssetUrl !== void 0 ? { isHostAssetUrl: e.isHostAssetUrl } : {},
      // ADR 004 §A1.3 — thread the host capture resolver to the runtime context
      // so the `x-zab.capture` primitive's ACQUIRE mode can pin a device.
      ...e.resolveCaptureDevice !== void 0 ? { resolveCaptureDevice: e.resolveCaptureDevice } : {},
      // ADR 006 #4 — thread the host peer-stream resolver (supplied by the
      // WebRTC viewer #3) so the `media` primitive's LIVE mode can render a
      // peer's MediaStream in `srcObject`.
      ...e.resolvePeerStream !== void 0 ? { resolvePeerStream: e.resolvePeerStream } : {},
      // ADR 006 #3 — reactive variant : the LIVE `media` node re-renders when a
      // peer connects/leaves mid-show. `createPeerViewer()` supplies it.
      ...e.subscribePeerStream !== void 0 ? { subscribePeerStream: e.subscribePeerStream } : {},
      // Un-mute LIVE peer `<video>` so guest WebRTC audio joins the on-air /
      // recording mix. On-air / recording hosts only — never an interactive
      // editor (echo risk). Omitted → muted (current behaviour).
      ...e.liveAudio !== void 0 ? { liveAudio: e.liveAudio } : {},
      // Editable Prism preview only. This bypasses the normal bindAnimate
      // rAF coalescer so a pointer edit can reach the rendered return without
      // adding a compositor frame. The Solar host opts in only through the
      // `editable_fast=1` preview URL marker; broadcast hosts never set it.
      ...e.realtimeDeltas !== void 0 ? { realtimeDeltas: e.realtimeDeltas } : {}
    })
  ), {
    disconnect() {
      f && (f = !1, R?.clear(), j?.(), w.close(), A.unmount());
    },
    setToken(d) {
      f && w.setToken(d);
    }
  };
  function P(d, y) {
    const S = i.value?.scene_version;
    for (const { scene_id: v, scene_version: p } of d)
      p !== S && (T.has(p) || (T.add(p), r.get(v, p).then((U) => {
        if (f && (e.onMetric?.({
          name: "roster_preloaded",
          scene_id: v,
          scene_version: p,
          source: y
        }), R)) {
          const $ = performance.now();
          R.warm(U).then((M) => {
            f && e.onMetric?.({
              name: "roster_images_preloaded",
              scene_id: v,
              scene_version: p,
              source: y,
              ...M,
              duration_ms: performance.now() - $
            });
          }).catch(() => {
          });
        }
      }).catch(() => {
        T.delete(p);
      })));
  }
  async function F(d, y, S, v, p, U, $, M) {
    let O;
    try {
      O = await d.get(v, p);
    } catch (K) {
      if (!f || M !== l) return;
      $({
        code: "BUNDLE_FETCH_FAILED",
        message: K instanceof Error ? K.message : "render bundle fetch failed",
        recoverable: !0
      });
      return;
    }
    if (!f || M !== l) return;
    const G = e.transformRoot;
    be(() => {
      x(() => {
        U(), y.value = G ? { ...O, root: G(O.root) } : O, S.value = `${v}::${p}`, c.value = { sceneId: v, sceneVersion: p };
      });
    });
  }
}
Object.assign(It, { supportsHostAssetUrls: !0 });
function At(e) {
  return {
    code: e.code,
    message: e.message,
    recoverable: e.recoverable
  };
}
function Pt(e) {
  try {
    const t = new URL(e);
    return `${t.protocol === "wss:" ? "https:" : "http:"}//${t.host}`;
  } catch {
    return "";
  }
}
const Mt = [
  "visible",
  "opacity",
  "universal_opacity",
  "rotation",
  // Figma negative-determinant transforms are lowered to `scaleY(-1)` by the
  // universal wrapper. Keep the prop in the allowlist so the already-consumed
  // mirror does not trigger an anti-drop diagnostic.
  "flipY",
  "sizing",
  "x",
  "y",
  "width",
  "height",
  // ADR 002 §3.2 (D2 / #D) — `blendMode` is consumed universally by the
  // wrapper (→ CSS `mix-blend-mode`) on every primitive.
  "blendMode",
  // ADR 002 §3.2 (#E) — a typed `mask` is lowered onto EVERY primitive by the
  // compiler and consumed by the Tree (built into a `<mask>` SVG element).
  "mask",
  // ADR 014 (Tier A issue #354 / Tier B issue #355) — consumed universally
  // by the wrapper : `blur`/`backdropBlur` → CSS filter/backdrop-filter,
  // `shadow` → box-shadow/drop-shadow (frame.tsx today ; universal is L1
  // follow-up), `noise`/`texture`/`glass` → EffectOverlays. Pre-existing gap
  // fixed alongside noise/texture/glass : `blur`/`shadow` were already
  // consumed by the wrapper/frame but never listed here, so every node
  // using them was spuriously flagged as a silent drop.
  "blur",
  // Bounded imported-Figma approximation: the renderer emits at most seven
  // `blur(100px)` passes, never an unbounded author radius.
  "staticBlurPasses",
  "backdropBlur",
  "shadow",
  "noise",
  "texture",
  "glass"
];
function g(e) {
  return /* @__PURE__ */ new Set([...Mt, ...e]);
}
const Ot = {
  stack: g(["direction", "gap", "wrap", "crossGap", "align", "justify"]),
  grid: g(["cols", "rows", "gap"]),
  frame: g([
    "x",
    "y",
    "width",
    "height",
    "scale",
    "rotate",
    "radius",
    "background",
    "backgrounds",
    "clipsContent",
    "frameStroke"
  ]),
  text: g([
    "value",
    "size",
    "font",
    "weight",
    "colour",
    "align",
    "textFills",
    "textOutline",
    "textAlignVertical",
    "textAutoResize",
    "lineHeight",
    "letterSpacing",
    "textTransform",
    "textDecoration",
    "fontStyle",
    "maxLines",
    "textSegments"
  ]),
  image: g([
    "src",
    "alt",
    "fit",
    "position",
    "width",
    "height",
    "imageTransform",
    // Figma IMAGE-paint scalingFactor, lowered by the compiler and consumed
    // by the image primitive before its pixels enter CSS compositing.
    "imageScaleFactor",
    "imageScaleMode",
    "imageFilters"
  ]),
  shape: g([
    "geometry",
    "kind",
    "width",
    "height",
    "radius",
    "cornerRadii",
    "fill",
    "fills",
    "stroke",
    "stroke_width",
    "stroke_align",
    "stroke_geometry",
    "strokes",
    "pathData",
    "paths",
    "ariaLabel"
  ]),
  // `peerLabel` (ADR 006 #4) selects the live MediaStream mode : a node whose
  // source is a `meet.peer.peer_label` is rendered in `srcObject` from a host
  // resolver instead of `<video src>`. Listed so it is NOT flagged as a silent
  // drop by the anti-drop audit when a scene carries a live source.
  media: g(["src", "peerLabel", "loop", "mute", "autoplay", "fit"]),
  // ADR 006 §3.3/§3.5 — the unified source kind. `peer_label` is the stream
  // reference (resolved to a MediaStream → srcObject) ; `object_fit`/`muted`
  // drive the video ; `x-zab.sourceKind` is advisory ; `metadata` carries the
  // editor round-trip (figma). Geometry is universal as flat `x/y/width/height`,
  // but an UNCOMPILED from-scene node carries the NESTED `position`/`size` shape
  // (the Tree flattens it as a fallback) — listed so neither form is flagged as
  // a silent drop by the anti-drop audit.
  "meet.peer": g([
    "peer_label",
    "object_fit",
    "muted",
    "x-zab.sourceKind",
    "metadata",
    "position",
    "size"
  ]),
  instance: g(["scene_id", "scene_version", "size", "position"]),
  // RFC-0001 / ADR 004 — vendor capture placeholder. `width`/`height` are the
  // flattened geometry (universal) ; the `x-zab.*` props are carried as
  // metadata (the renderer reserves the box, ignores deviceRef). Listed so
  // they are NOT flagged as silent drops by the anti-drop audit.
  "x-zab.capture": g(["x-zab.sourceKind", "x-zab.deviceRef", "width", "height", "fit"]),
  // ADR Blue 009 §3.1 (Amendment 2) — vendor meet-peer SLOT placeholder.
  // `width`/`height` are the flattened geometry (universal) ; `x-zab.slotRef`
  // is the logical slot identity carried as metadata (the runtime resolves
  // `slotRef → peer_label` from stream-level ZabCam state). NO cam/peer
  // identity is carried. Listed so they are NOT flagged as silent drops.
  "x-zab.meet-peer": g(["x-zab.slotRef", "width", "height"]),
  // `repeat` is dispatched specially by the tree ; its only consumed
  // binding is `items`.
  repeat: /* @__PURE__ */ new Set(["items"])
};
function Lt(e, t) {
  const s = Ot[e];
  return !!(s === void 0 || s.has(t) || e === "instance" && (t === "params" || t.startsWith("params.")));
}
const ae = /* @__PURE__ */ new WeakSet();
function os(e) {
  if (ae.has(e)) return;
  ae.add(e);
  const t = /* @__PURE__ */ new Set([
    ...Object.keys(e.props ?? {}),
    ...Object.keys(e.bindings ?? {})
  ]);
  for (const s of t)
    Lt(e.kind, s) || X(
      e.id,
      `${e.kind}.${s}`,
      "is not consumed by this primitive's renderer ; the prop is ignored (anti-silent-drop, ADR 001 §3.4)"
    );
}
class ve {
  constructor(t) {
    this.options = t, this.deps = {
      WebSocket: t.deps?.WebSocket ?? globalThis.WebSocket,
      RTCPeerConnection: t.deps?.RTCPeerConnection ?? globalThis.RTCPeerConnection,
      MediaStream: t.deps?.MediaStream ?? globalThis.MediaStream
    };
  }
  ws = null;
  remotes = /* @__PURE__ */ new Map();
  iceServers = [];
  selfId = null;
  listeners = /* @__PURE__ */ new Map();
  deps;
  on(t, s) {
    const n = this.listeners.get(t) ?? /* @__PURE__ */ new Set();
    return this.listeners.set(t, n), n.add(s), () => n.delete(s);
  }
  /** Join the room as a VIEWER (recvonly). No capture, no publish. */
  join() {
    return this.openSocket();
  }
  /** Leave and tear down every peer connection + aggregated stream. As the
   *  track owner, this is where the streams (and the device-side tracks) end. */
  leave() {
    this.send({ type: "leave" }), this.ws?.close(1e3, "viewer-leave");
  }
  /* ---- Socket ------------------------------------------------------- */
  openSocket() {
    const t = new URL(this.options.signalingUrl);
    return t.searchParams.set("room", this.options.roomId), t.searchParams.set("token", this.options.token), new Promise((s, n) => {
      const r = new this.deps.WebSocket(t.toString());
      this.ws = r;
      const i = () => {
        r.removeEventListener("error", o), this.send({ type: "join", name: this.options.name, role: "viewer" }), s();
      }, o = (a) => {
        r.removeEventListener("open", i), n(a);
      };
      r.addEventListener("open", i, { once: !0 }), r.addEventListener("error", o, { once: !0 }), r.addEventListener("message", (a) => void this.onMessage(a.data)), r.addEventListener("close", (a) => {
        this.tearDown(), this.emit("close", { code: a.code, reason: a.reason });
      });
    });
  }
  send(t) {
    this.ws && this.ws.readyState === this.deps.WebSocket.OPEN && this.ws.send(JSON.stringify(t));
  }
  tearDown() {
    for (const t of this.remotes.values()) t.pc.close();
    this.remotes.clear();
  }
  /* ---- Protocol ----------------------------------------------------- */
  async onMessage(t) {
    let s;
    try {
      s = JSON.parse(String(t));
    } catch {
      return;
    }
    switch (s.type) {
      case "joined": {
        this.selfId = s.peerId, this.iceServers = s.turn.urls.map((n) => ({
          urls: n,
          username: s.turn.username,
          credential: s.turn.credential
        })), this.emit("joined", { peerId: s.peerId, peers: s.peers });
        for (const n of s.peers) this.ensureRemote(n);
        break;
      }
      case "peer-joined": {
        this.emit("peer-joined", s.peer), this.ensureRemote(s.peer);
        break;
      }
      case "peer-left": {
        const n = this.remotes.get(s.peerId);
        n && (n.pc.close(), this.remotes.delete(s.peerId), this.emit("peer-left", { peerId: s.peerId, peerName: n.info.name }));
        break;
      }
      case "signal": {
        await this.handleSignal(s.from, s.payload);
        break;
      }
      case "error": {
        this.emit("error", { code: s.code, message: s.message });
        break;
      }
    }
  }
  async handleSignal(t, s) {
    let n = this.remotes.get(t);
    n || (n = this.ensureRemote({ id: t, name: t.slice(0, 8), role: "publisher" }));
    const { pc: r } = n;
    if (s.kind === "sdp") {
      const i = s.description, o = i.type === "offer" && (n.makingOffer || r.signalingState !== "stable");
      if (n.ignoreOffer = !this.isPolite(t) && o, n.ignoreOffer) return;
      await r.setRemoteDescription(i);
      for (const a of n.pendingCandidates)
        try {
          await r.addIceCandidate(a);
        } catch {
        }
      n.pendingCandidates = [], i.type === "offer" && (await r.setLocalDescription(), r.localDescription && this.sendSignal(t, {
        kind: "sdp",
        description: {
          type: r.localDescription.type,
          sdp: r.localDescription.sdp
        }
      }));
      return;
    }
    if (s.kind === "ice") {
      const i = s.candidate;
      if (r.remoteDescription)
        try {
          await r.addIceCandidate(i);
        } catch (o) {
          if (!n.ignoreOffer) throw o;
        }
      else
        n.pendingCandidates.push(i);
      return;
    }
  }
  /* ---- Peer setup --------------------------------------------------- */
  ensureRemote(t) {
    const s = this.remotes.get(t.id);
    if (s) return s;
    const n = new this.deps.RTCPeerConnection({
      iceServers: this.iceServers,
      iceTransportPolicy: "relay"
    }), r = new this.deps.MediaStream(), i = n.addTransceiver("audio", { direction: "recvonly" }), o = n.addTransceiver("video", { direction: "recvonly" });
    Ct(i, o);
    const a = {
      info: t,
      pc: n,
      stream: r,
      makingOffer: !1,
      ignoreOffer: !1,
      pendingCandidates: []
    };
    return n.addEventListener("negotiationneeded", () => {
      (async () => {
        try {
          a.makingOffer = !0, await n.setLocalDescription(), n.localDescription && this.sendSignal(t.id, {
            kind: "sdp",
            description: {
              type: n.localDescription.type,
              sdp: n.localDescription.sdp
            }
          });
        } catch {
        } finally {
          a.makingOffer = !1;
        }
      })();
    }), n.addEventListener("icecandidate", (c) => {
      const l = c.candidate;
      l && this.sendSignal(t.id, {
        kind: "ice",
        candidate: {
          candidate: l.candidate,
          sdpMid: l.sdpMid,
          sdpMLineIndex: l.sdpMLineIndex,
          usernameFragment: l.usernameFragment
        }
      });
    }), n.addEventListener("track", (c) => {
      const l = c.track;
      a.stream.getTracks().includes(l) || a.stream.addTrack(l), l.addEventListener("ended", () => {
        a.stream.removeTrack(l);
      }), this.emit("remote-track", {
        peerId: t.id,
        peerName: t.name,
        stream: a.stream
      });
    }), n.addEventListener("connectionstatechange", () => {
      this.emit("connection-state", { peerId: t.id, state: n.connectionState }), (n.connectionState === "failed" || n.connectionState === "closed") && (this.remotes.delete(t.id), this.emit("peer-left", { peerId: t.id, peerName: t.name }));
    }), this.remotes.set(t.id, a), a;
  }
  /* ---- Helpers ------------------------------------------------------ */
  isPolite(t) {
    return this.selfId ? this.selfId > t : !1;
  }
  sendSignal(t, s) {
    this.send({ type: "signal", to: t, payload: s });
  }
  emit(t, s) {
    const n = this.listeners.get(t);
    if (n)
      for (const r of n) r(s);
  }
}
function Ct(e, t) {
  const s = globalThis.RTCRtpReceiver?.getCapabilities;
  typeof s == "function" && (ce(t, s("video"), (n) => {
    const r = n.toLowerCase();
    return r === "video/h264" || r === "video/rtx";
  }), ce(e, s("audio"), (n) => {
    const r = n.toLowerCase();
    return r === "audio/opus" || r === "audio/telephone-event";
  }));
}
function ce(e, t, s) {
  const n = e?.setCodecPreferences;
  if (typeof n != "function" || !t) return;
  const r = t.codecs.filter((i) => s(i.mimeType));
  if (r.length !== 0)
    try {
      n.call(e, r);
    } catch {
    }
}
function we() {
  const e = /* @__PURE__ */ new Map(), t = /* @__PURE__ */ new Map(), s = /* @__PURE__ */ new Set();
  function n(i) {
    const o = t.get(i);
    if (o === void 0) return;
    const a = e.get(i) ?? null;
    for (const c of o) c(a);
  }
  function r() {
    for (const i of [...s]) i();
  }
  return {
    resolve(i) {
      return e.get(i) ?? null;
    },
    orderedLabels() {
      return [...e.keys()];
    },
    subscribeRoster(i) {
      return s.add(i), () => {
        s.delete(i);
      };
    },
    subscribe(i, o) {
      let a = t.get(i);
      return a === void 0 && (a = /* @__PURE__ */ new Set(), t.set(i, a)), a.add(o), o(e.get(i) ?? null), () => {
        const c = t.get(i);
        c !== void 0 && (c.delete(o), c.size === 0 && t.delete(i));
      };
    },
    set(i, o) {
      if (e.get(i) === o) return;
      const a = !e.has(i);
      e.set(i, o), n(i), a && r();
    },
    remove(i) {
      e.has(i) && (e.delete(i), n(i), r());
    },
    clear() {
      const i = [...e.keys()];
      e.clear();
      for (const o of i) n(o);
      i.length > 0 && r();
    }
  };
}
function E(e) {
  return e.toLowerCase().replace(/[^a-z0-9_-]+/g, "_").replace(/^[_-]+|[_-]+$/g, "");
}
function ye(e, t, s) {
  e.on("remote-track", (n) => {
    const r = E(n.peerName);
    s.acquire(r, e) && t.set(r, n.stream);
  }), e.on("peer-left", (n) => {
    const r = E(n.peerName);
    s.acquire(r, e) && (t.remove(r), s.release(r, e));
  });
}
const xt = {
  acquire: () => !0,
  release: () => {
  }
};
function as(e) {
  const t = we(), s = new ve(e);
  return ye(s, t, xt), {
    join: () => s.join(),
    leave: () => {
      s.leave(), t.clear();
    },
    resolvePeerStream: (n) => t.resolve(E(n)),
    subscribePeerStream: (n, r) => t.subscribe(E(n), r),
    registry: t,
    viewer: s
  };
}
function le(e) {
  const t = we(), s = /* @__PURE__ */ new Map(), n = /* @__PURE__ */ new Map(), r = {
    acquire: (a, c) => {
      const l = n.get(a);
      return l === void 0 ? (n.set(a, c), !0) : l === c;
    },
    release: (a, c) => {
      n.get(a) === c && n.delete(a);
    }
  };
  function i(a) {
    if (s.has(a.roomId)) return;
    const c = new ve({
      name: a.name ?? "solar-viewer",
      ...a,
      ...e.deps !== void 0 && a.deps === void 0 ? { deps: e.deps } : {}
    });
    ye(c, t, r), s.set(a.roomId, { viewer: c });
  }
  function o(a) {
    const c = s.get(a);
    if (c !== void 0) {
      for (const [l, u] of [...n.entries()])
        u === c.viewer && (t.remove(l), n.delete(l));
      c.viewer.leave(), s.delete(a);
    }
  }
  for (const a of e.rooms) i(a);
  return {
    join: async () => {
      await Promise.all([...s.values()].map((a) => a.viewer.join()));
    },
    leave: () => {
      for (const a of [...s.keys()]) o(a);
      t.clear();
    },
    setRooms: async (a) => {
      const c = new Set(a.map((u) => u.roomId));
      for (const u of [...s.keys()])
        c.has(u) || o(u);
      const l = [];
      for (const u of a)
        if (!s.has(u.roomId)) {
          i(u);
          const m = s.get(u.roomId);
          m && l.push(m.viewer);
        }
      await Promise.all(l.map((u) => u.join()));
    },
    resolvePeerStream: (a) => t.resolve(E(a)),
    subscribePeerStream: (a, c) => t.subscribe(E(a), c),
    registry: t
  };
}
function cs(e) {
  if ("rooms" in e && Array.isArray(e.rooms))
    return le(e);
  const { name: t, deps: s, ...n } = e;
  return le({
    rooms: [{ ...n, ...t !== void 0 ? { name: t } : {} }],
    ...s !== void 0 ? { deps: s } : {}
  });
}
const Nt = { width: 1920, height: 1080 }, Dt = () => {
};
function ls(e) {
  const t = e.stage ?? Nt, s = e.target;
  s.style.position ||= "relative", s.style.width = `${t.width}px`, s.style.height = `${t.height}px`, s.style.overflow = "hidden";
  const n = e.onDiagnostic ? he(e.onDiagnostic) : void 0, r = C();
  r.reset(e.defaults ?? e.bundle.defaults ?? {});
  const i = de(s);
  return {
    ready: new Promise((a) => {
      import("./broadcast--VSPjpD_.js").then(({ BroadcastMode: c }) => {
        i.render(
          /* @__PURE__ */ h(Te, { children: /* @__PURE__ */ h(
            fe,
            {
              value: {
                mode: "broadcast",
                store: r,
                bundle: e.bundle,
                status: "live",
                sendInput: Dt
              },
              children: /* @__PURE__ */ h(c, {})
            }
          ) })
        );
        const l = new Promise((m) => {
          requestAnimationFrame(() => requestAnimationFrame(() => m()));
        }), u = typeof document < "u" && document.fonts ? document.fonts.ready.then(() => {
        }) : Promise.resolve();
        Promise.all([l, u]).then(() => a());
      });
    }),
    unmount() {
      n?.(), i.unmount();
    }
  };
}
function Se(e, t) {
  if (typeof e != "string") return e;
  if (t[e]) return t[e];
  const s = /^assets\/([A-Za-z0-9]+)\.[A-Za-z0-9]+$/.exec(e);
  return s && s[1] !== void 0 && t[s[1]] ? t[s[1]] : e;
}
function ue(e, t) {
  if (e === null || typeof e != "object") return;
  if (Array.isArray(e)) {
    for (const n of e) ue(n, t);
    return;
  }
  const s = e;
  "src" in s && (s.src = Se(s.src, t));
  for (const n of Object.values(s))
    n && typeof n == "object" && ue(n, t);
}
function us(e, t) {
  const s = { ...e };
  for (const [n, r] of Object.entries(s))
    n.startsWith("__lit.image.") && (s[n] = Se(r, t));
  return s;
}
async function ds(e) {
  const t = [];
  for (const s of e)
    try {
      const n = new FontFace(s.family, s.src, {
        weight: String(s.weight),
        style: s.style ?? "normal"
      });
      await n.load(), document.fonts.add(n), t.push(s.family);
    } catch {
    }
  return t;
}
export {
  ss as A,
  ne as B,
  ts as C,
  cs as D,
  ds as E,
  Jt as F,
  mt as G,
  ee as H,
  It as I,
  ls as J,
  Se as K,
  us as L,
  J as M,
  ue as N,
  re as O,
  Ot as P,
  dt as S,
  ns as a,
  rs as b,
  Qt as c,
  Kt as d,
  X as e,
  Z as f,
  is as g,
  Vt as h,
  Gt as i,
  Xt as j,
  os as k,
  Be as l,
  es as m,
  Yt as n,
  z as o,
  me as p,
  ve as q,
  bt as r,
  Qe as s,
  Zt as t,
  qt as u,
  he as v,
  et as w,
  le as x,
  we as y,
  as as z
};
//# sourceMappingURL=index-DYoYgjoZ.js.map
