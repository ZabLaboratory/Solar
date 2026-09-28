import { jsxs as i, jsx as e, Fragment as y } from "react/jsx-runtime";
import { T as b } from "./tree-AMqu7A5c.js";
import { u as f, A as h, r as x } from "./index-DYoYgjoZ.js";
import { S, C as k } from "./status-pill-CQ1fDyZJ.js";
import { useSignals as v } from "@preact/signals-react/runtime";
import { useState as u } from "react";
const T = {
  position: "fixed",
  bottom: 12,
  right: 12,
  zIndex: 100001,
  width: 360,
  maxHeight: "70vh",
  overflowY: "auto",
  padding: 12,
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: 12,
  color: "#e5e7eb",
  background: "rgba(8, 47, 73, 0.92)",
  border: "1px solid rgba(56, 189, 248, 0.4)",
  borderRadius: 10,
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.45)"
}, c = {
  fontWeight: 600,
  fontSize: 11,
  letterSpacing: "0.06em",
  color: "#7dd3fc",
  textTransform: "uppercase",
  marginBottom: 6
}, a = {
  background: "rgba(14, 165, 233, 0.4)",
  border: "1px solid rgba(125, 211, 252, 0.5)",
  borderRadius: 6,
  color: "#f0f9ff",
  padding: "3px 8px",
  fontSize: 11,
  cursor: "pointer"
}, _ = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "6px 0",
  borderBottom: "1px solid rgba(56, 189, 248, 0.2)"
};
function C() {
  const { bundle: t, store: n, sendInput: r } = f();
  v();
  const [s, l] = u(""), p = t.external_adapters ?? [], g = n.toRecord(), m = Object.entries(g).filter(
    ([o]) => s === "" || o.includes(s)
  );
  return /* @__PURE__ */ i("div", { style: T, "data-testid": "lumencast-test-panel", children: [
    /* @__PURE__ */ e("div", { style: c, children: "Time" }),
    /* @__PURE__ */ i("div", { style: { display: "flex", gap: 6, marginBottom: 8 }, children: [
      /* @__PURE__ */ e(
        "button",
        {
          type: "button",
          style: a,
          onClick: () => r([{ path: "__test.tick", value: 100 }]),
          children: "tick +100ms"
        }
      ),
      /* @__PURE__ */ e(
        "button",
        {
          type: "button",
          style: a,
          onClick: () => r([{ path: "__test.tick", value: 1e3 }]),
          children: "tick +1s"
        }
      ),
      /* @__PURE__ */ e(
        "button",
        {
          type: "button",
          style: a,
          onClick: () => r([{ path: "__test.reset", value: !0 }]),
          children: "reset"
        }
      )
    ] }),
    /* @__PURE__ */ e("div", { style: c, children: "External adapters" }),
    p.length === 0 && /* @__PURE__ */ e("div", { style: { color: "#94a3b8", fontStyle: "italic", fontSize: 11 }, children: "No external adapters declared in this scene." }),
    p.map((o) => /* @__PURE__ */ e(
      z,
      {
        adapter: o,
        onMock: (d) => (
          // LSDP/1 patch values must be leaf — JSON-encode the structured payload.
          r([
            {
              path: "__test.mock_adapter",
              value: JSON.stringify({ key: o.key, payload: d })
            }
          ])
        )
      },
      o.key
    )),
    /* @__PURE__ */ e("div", { style: { ...c, marginTop: 12 }, children: "State" }),
    /* @__PURE__ */ e(
      "input",
      {
        type: "text",
        placeholder: "filter paths…",
        value: s,
        onChange: (o) => l(o.target.value),
        style: {
          background: "rgba(8, 47, 73, 0.6)",
          border: "1px solid rgba(125, 211, 252, 0.4)",
          borderRadius: 6,
          color: "#e0f2fe",
          padding: "4px 6px",
          fontSize: 11,
          width: "100%",
          marginBottom: 6
        }
      }
    ),
    /* @__PURE__ */ e("div", { style: { fontFamily: "monospace", fontSize: 10.5 }, children: m.map(([o, d]) => /* @__PURE__ */ i(
      "div",
      {
        style: {
          display: "grid",
          gridTemplateColumns: "1fr auto",
          gap: 8,
          padding: "2px 0",
          borderBottom: "1px dashed rgba(125, 211, 252, 0.15)"
        },
        children: [
          /* @__PURE__ */ e("span", { style: { color: "#bae6fd" }, children: o }),
          /* @__PURE__ */ e("span", { style: { color: "#fef3c7" }, children: R(d) })
        ]
      },
      o
    )) })
  ] });
}
function z({
  adapter: t,
  onMock: n
}) {
  const [r, s] = u("{}");
  return /* @__PURE__ */ i("div", { style: _, children: [
    /* @__PURE__ */ i(
      "div",
      {
        style: {
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center"
        },
        children: [
          /* @__PURE__ */ e("span", { style: { color: "#e0f2fe" }, children: t.label }),
          /* @__PURE__ */ e("span", { style: { color: "#94a3b8", fontSize: 10 }, children: t.kind })
        ]
      }
    ),
    /* @__PURE__ */ e(
      "textarea",
      {
        value: r,
        onChange: (l) => s(l.target.value),
        rows: 2,
        style: {
          fontFamily: "monospace",
          fontSize: 10.5,
          background: "rgba(8, 47, 73, 0.6)",
          color: "#e0f2fe",
          border: "1px solid rgba(125, 211, 252, 0.3)",
          borderRadius: 4,
          padding: 4,
          resize: "vertical"
        }
      }
    ),
    /* @__PURE__ */ e(
      "button",
      {
        type: "button",
        style: a,
        onClick: () => {
          try {
            const l = JSON.parse(r);
            n(l);
          } catch {
            n(r);
          }
        },
        children: "fire"
      }
    )
  ] });
}
function R(t) {
  return t === void 0 ? "—" : t === null ? "null" : typeof t == "string" || typeof t == "object" ? JSON.stringify(t) : String(t);
}
function F() {
  const { store: t, bundle: n, isHostAssetUrl: r } = f();
  return /* @__PURE__ */ i(y, { children: [
    /* @__PURE__ */ e(h, { hosts: x(n), isHostAssetUrl: r, children: /* @__PURE__ */ e(b, { node: n.root, store: t }) }),
    /* @__PURE__ */ e(S, {}),
    /* @__PURE__ */ e(k, {}),
    /* @__PURE__ */ e(C, {})
  ] });
}
export {
  F as TestMode
};
//# sourceMappingURL=test-YJAdoshm.js.map
