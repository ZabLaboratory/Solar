// @vitest-environment happy-dom

import { afterEach, describe, expect, it, vi } from "vitest";

import { installEditablePreviewSideband } from "../../src/internal/editable-preview/sideband";

type Patch = { componentId: string; property: string; value: unknown };

const teardowns: (() => void)[] = [];

function sideband(root: ParentNode = document) {
  let now = 0;
  let nextFrameId = 0;
  const frames = new Map<number, FrameRequestCallback>();
  vi.spyOn(performance, "now").mockImplementation(() => now);
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    const id = ++nextFrameId;
    frames.set(id, callback);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));

  class TestSocket extends EventTarget {
    close = vi.fn();
  }
  const socket = new TestSocket();
  const Socket = vi.fn(function () {
    return socket;
  });
  const stop = installEditablePreviewSideband(
    "ws://127.0.0.1/editable-preview",
    root,
    Socket as unknown as typeof WebSocket,
  );
  teardowns.push(stop);

  return {
    frames,
    stop,
    close: socket.close,
    accept(...patches: Patch[]) {
      socket.dispatchEvent(
        new MessageEvent("message", {
          data: JSON.stringify({
            type: "accepted_patch",
            patches: patches.map(({ componentId, property, value }) => ({
              path: `__editable.${Array.from(new TextEncoder().encode(componentId), (byte) => byte.toString(16).padStart(2, "0")).join("")}.${property}`,
              value,
            })),
          }),
        }),
      );
    },
    frame(at = now + 16) {
      now = at;
      const callbacks = [...frames.values()];
      frames.clear();
      for (const callback of callbacks) callback(now);
    },
  };
}

afterEach(() => {
  for (const stop of teardowns.splice(0)) stop();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("editable Preview sideband convergence targets", () => {
  it("reuses DOM selections while reasserting values overwritten by the runtime", () => {
    document.body.innerHTML = `
      <div id="panel" data-lumencast-bind-animate="panel">
        <span>Title</span><svg><rect fill="#000" /></svg>
      </div>`;
    const panel = document.getElementById("panel")!;
    const text = panel.querySelector("span")!;
    const paint = panel.querySelector("rect")!;
    const bindings = vi.spyOn(document, "querySelectorAll");
    const descendants = vi.spyOn(panel, "querySelectorAll");
    const first = vi.spyOn(panel, "querySelector");
    const preview = sideband();
    preview.accept(
      { componentId: "panel", property: "width", value: 640 },
      { componentId: "panel", property: "fontSize", value: 48 },
      { componentId: "panel", property: "fill", value: "#ff0066" },
      { componentId: "panel", property: "translate", value: [61, 40] },
    );
    expect(bindings).toHaveBeenCalledTimes(1);
    expect(descendants).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(1);

    panel.style.width = "1px";
    panel.style.transform = "none";
    text.style.fontSize = "1px";
    paint.setAttribute("fill", "#000");
    preview.frame();
    preview.frame();
    expect(panel.style.width).toBe("640px");
    expect(panel.style.getPropertyPriority("width")).toBe("important");
    expect(panel.style.transform).toBe("translate3d(61px, 40px, 0px)");
    expect(text.style.fontSize).toBe("48px");
    expect(paint.getAttribute("fill")).toBe("#ff0066");
    expect(bindings).toHaveBeenCalledTimes(1);
    expect(descendants).toHaveBeenCalledTimes(2);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it("refreshes descendant selections synchronously after a subtree replacement", () => {
    document.body.innerHTML = `
      <div id="panel" data-lumencast-bind-animate="panel">
        <span>Before</span><svg><rect fill="#000" /></svg><img />
      </div>`;
    const panel = document.getElementById("panel")!;
    const oldText = panel.querySelector("span")!;
    const preview = sideband();
    preview.accept(
      { componentId: "panel", property: "value", value: "Accepted" },
      { componentId: "panel", property: "width", value: 640 },
      { componentId: "panel", property: "fill", value: "#ff0066" },
      {
        componentId: "panel",
        property: "src",
        value: "https://assets.example/new.png",
      },
    );
    panel.innerHTML =
      '<div><span>Replacement</span><svg><path fill="#000" /></svg><img /></div>';
    oldText.textContent = "Detached";
    preview.frame();
    expect(panel.querySelector("span")?.textContent).toBe("Accepted");
    expect(panel.querySelector("div")?.style.width).toBe("640px");
    expect(panel.querySelector("path")?.getAttribute("fill")).toBe("#ff0066");
    expect(panel.querySelector("img")?.src).toBe(
      "https://assets.example/new.png",
    );
    expect(oldText.textContent).toBe("Detached");
  });

  it("finds initially missing wrappers and follows complete wrapper replacement", async () => {
    const preview = sideband();
    preview.accept({ componentId: "panel", property: "opacity", value: 0.5 });
    document.body.innerHTML =
      '<div id="first" data-lumencast-bind-animate="panel"></div>';
    preview.frame();
    const first = document.getElementById("first")!;
    expect(first.style.opacity).toBe("0.5");

    document.body.innerHTML =
      '<div id="second" data-lumencast-bind-animate="panel"></div>';
    first.style.opacity = "0.9";
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    preview.frame();
    expect(document.getElementById("second")?.style.opacity).toBe("0.5");
    expect(first.style.opacity).toBe("0.9");
  });

  it("preserves duplicate ordering and all translation targets after binding changes", () => {
    document.body.innerHTML = `
      <div id="a" data-lumencast-bind-animate="panel"></div>
      <div id="b" data-lumencast-bind-animate="panel"></div>`;
    const a = document.getElementById("a")!;
    const b = document.getElementById("b")!;
    const preview = sideband();
    preview.accept(
      { componentId: "panel", property: "opacity", value: 0.5 },
      { componentId: "panel", property: "translate", value: [20, 30] },
    );
    expect(a.style.opacity).toBe("0.5");
    expect(b.style.opacity).toBe("");
    document.body.prepend(b);
    a.style.opacity = "0.8";
    a.style.transform = "none";
    b.style.transform = "none";
    preview.frame();
    expect(b.style.opacity).toBe("0.5");
    expect(a.style.opacity).toBe("0.8");
    expect(a.style.transform).toBe("translate3d(20px, 30px, 0px)");
    expect(b.style.transform).toBe(a.style.transform);

    b.setAttribute("data-lumencast-bind-animate", "other");
    b.style.opacity = "0.9";
    b.style.transform = "none";
    preview.frame();
    expect(a.style.opacity).toBe("0.5");
    expect(b.style.opacity).toBe("0.9");
    expect(b.style.transform).toBe("none");
  });

  it("retains text selections across text-node mutations and accepts newer values", async () => {
    document.body.innerHTML =
      '<div data-lumencast-bind-animate="panel"><span>Before</span></div>';
    const bindings = vi.spyOn(document, "querySelectorAll");
    const preview = sideband();
    preview.accept({
      componentId: "panel",
      property: "value",
      value: "Accepted",
    });
    preview.frame();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    preview.frame();
    preview.accept({ componentId: "panel", property: "value", value: "Newer" });
    preview.frame();
    expect(document.querySelector("span")?.textContent).toBe("Newer");
    expect(bindings).toHaveBeenCalledTimes(1);
  });

  it("releases selections at expiry and teardown, including late socket messages", () => {
    document.body.innerHTML =
      '<div id="panel" data-lumencast-bind-animate="panel"></div>';
    const disconnect = vi.spyOn(MutationObserver.prototype, "disconnect");
    const preview = sideband();
    preview.accept({ componentId: "panel", property: "opacity", value: 0.5 });
    preview.frame(1250);
    expect(preview.frames.size).toBe(0);
    expect(disconnect).toHaveBeenCalledTimes(1);

    document.body.innerHTML =
      '<div id="new" data-lumencast-bind-animate="panel"></div>';
    preview.accept({ componentId: "panel", property: "opacity", value: 0.6 });
    expect(document.getElementById("new")?.style.opacity).toBe("0.6");
    preview.stop();
    expect(disconnect).toHaveBeenCalledTimes(2);
    expect(preview.close).toHaveBeenCalledWith(1000, "solar teardown");
    expect(preview.frames.size).toBe(0);
    preview.accept({ componentId: "panel", property: "opacity", value: 0.9 });
    expect(document.getElementById("new")?.style.opacity).toBe("0.6");
    expect(preview.frames.size).toBe(0);
  });

  it("falls back to fresh selections when MutationObserver is unavailable", () => {
    vi.stubGlobal("MutationObserver", undefined);
    document.body.innerHTML = '<div data-lumencast-bind-animate="panel"></div>';
    const preview = sideband();
    preview.accept({ componentId: "panel", property: "opacity", value: 0.5 });
    document.body.innerHTML =
      '<div id="new" data-lumencast-bind-animate="panel"></div>';
    preview.frame();
    expect(document.getElementById("new")?.style.opacity).toBe("0.5");
  });
});
