import { jsxs as c, jsx as s } from "react/jsx-runtime";
import { useSignals as g } from "@preact/signals-react/runtime";
import { u as d } from "./index-DYoYgjoZ.js";
const f = {
  position: "fixed",
  bottom: 12,
  left: 12,
  zIndex: 1e5,
  width: 320,
  maxHeight: "70vh",
  overflowY: "auto",
  padding: 12,
  fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
  fontSize: 12,
  color: "#e5e7eb",
  background: "rgba(17, 24, 39, 0.92)",
  border: "1px solid rgba(75, 85, 99, 0.6)",
  borderRadius: 10,
  boxShadow: "0 8px 32px rgba(0, 0, 0, 0.45)"
}, m = {
  display: "flex",
  flexDirection: "column",
  gap: 4,
  padding: "6px 0",
  borderBottom: "1px solid rgba(75, 85, 99, 0.35)"
}, h = {
  color: "#9ca3af",
  fontSize: 10.5,
  letterSpacing: "0.02em",
  textTransform: "uppercase"
}, p = {
  background: "rgba(31, 41, 55, 0.8)",
  border: "1px solid rgba(75, 85, 99, 0.6)",
  borderRadius: 6,
  color: "#f9fafb",
  padding: "4px 6px",
  fontSize: 12,
  width: "100%"
};
function k() {
  const { bundle: o, store: t, sendInput: a } = d();
  g();
  const n = o.operator_inputs ?? [];
  if (n.length === 0) return null;
  const e = /* @__PURE__ */ new Map();
  for (const r of n) {
    const l = r.group ?? "General", i = e.get(l) ?? [];
    i.push(r), e.set(l, i);
  }
  return /* @__PURE__ */ c("div", { style: f, "data-testid": "lumencast-control-panel", children: [
    /* @__PURE__ */ s(
      "div",
      {
        style: {
          fontWeight: 600,
          fontSize: 11,
          letterSpacing: "0.06em",
          color: "#9ca3af",
          textTransform: "uppercase",
          marginBottom: 6
        },
        children: "Operator inputs"
      }
    ),
    [...e.entries()].map(([r, l]) => /* @__PURE__ */ c("div", { style: { marginBottom: 8 }, children: [
      /* @__PURE__ */ s(
        "div",
        {
          style: {
            color: "#6b7280",
            fontSize: 10,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            padding: "4px 0"
          },
          children: r
        }
      ),
      l.map((i) => /* @__PURE__ */ s(
        b,
        {
          entry: i,
          currentValue: t.signal(i.path).value,
          onCommit: (u) => (
            // Operator-control values come from form widgets typed per
            // OperatorInput.type; coerce to LeafValue at the boundary.
            a([
              {
                path: i.path,
                value: u
              }
            ])
          )
        },
        i.path
      ))
    ] }, r))
  ] });
}
function b({
  entry: o,
  currentValue: t,
  onCommit: a
}) {
  return /* @__PURE__ */ c("div", { style: m, children: [
    /* @__PURE__ */ s("span", { style: h, children: o.label }),
    /* @__PURE__ */ s(x, { entry: o, currentValue: t, onCommit: a })
  ] });
}
function x({
  entry: o,
  currentValue: t,
  onCommit: a
}) {
  switch (o.type) {
    case "boolean": {
      const n = t === !0;
      return /* @__PURE__ */ c("label", { style: { display: "flex", alignItems: "center", gap: 6 }, children: [
        /* @__PURE__ */ s("input", { type: "checkbox", checked: n, onChange: (e) => a(e.target.checked) }),
        /* @__PURE__ */ s("span", { style: { fontSize: 11, color: "#d1d5db" }, children: n ? "on" : "off" })
      ] });
    }
    case "number": {
      const n = o.min, e = o.max, r = o.step;
      return /* @__PURE__ */ s(
        "input",
        {
          type: "number",
          style: p,
          value: typeof t == "number" ? t : "",
          min: n,
          max: e,
          step: r,
          onChange: (l) => {
            const i = Number(l.target.value);
            Number.isFinite(i) && a(i);
          }
        }
      );
    }
    case "text": {
      const n = o.max_length;
      return /* @__PURE__ */ s(
        "input",
        {
          type: "text",
          style: p,
          value: typeof t == "string" ? t : "",
          maxLength: n,
          onChange: (e) => a(e.target.value)
        }
      );
    }
    case "colour":
      return /* @__PURE__ */ s(
        "input",
        {
          type: "color",
          style: p,
          value: typeof t == "string" ? t : "#000000",
          onChange: (n) => a(n.target.value)
        }
      );
    case "duration":
      return /* @__PURE__ */ s(
        "input",
        {
          type: "number",
          style: p,
          value: typeof t == "number" ? t : "",
          min: 0,
          step: 100,
          onChange: (n) => {
            const e = Number(n.target.value);
            Number.isFinite(e) && e >= 0 && a(e);
          }
        }
      );
    case "select":
    case "enum": {
      const n = o.enum_values ?? o.options ?? [];
      return /* @__PURE__ */ s(
        "select",
        {
          style: p,
          value: typeof t == "string" ? t : "",
          onChange: (e) => a(e.target.value),
          children: n.map((e) => /* @__PURE__ */ s("option", { value: e, children: e }, e))
        }
      );
    }
    case "path-ref":
    default:
      return /* @__PURE__ */ s(
        "input",
        {
          type: "text",
          style: p,
          value: typeof t == "string" ? t : "",
          onChange: (n) => a(n.target.value)
        }
      );
  }
}
const y = {
  live: "rgba(34, 197, 94, 0.85)",
  connecting: "rgba(234, 179, 8, 0.85)",
  disconnected: "rgba(239, 68, 68, 0.85)"
}, v = {
  live: "live",
  connecting: "reconnecting",
  disconnected: "disconnected"
};
function w() {
  const { status: o } = d();
  return /* @__PURE__ */ s(
    "div",
    {
      "data-testid": "lumencast-status-pill",
      style: {
        position: "fixed",
        top: 12,
        right: 12,
        padding: "4px 10px",
        fontSize: 11,
        fontFamily: "system-ui, -apple-system, BlinkMacSystemFont, sans-serif",
        color: "white",
        background: y[o] ?? "#444",
        borderRadius: 999,
        userSelect: "none",
        pointerEvents: "none"
      },
      children: v[o] ?? o
    }
  );
}
export {
  k as C,
  w as S
};
//# sourceMappingURL=status-pill-CQ1fDyZJ.js.map
