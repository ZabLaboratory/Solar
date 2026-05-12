// PrismScene — public API smoke tests. Once published, every shape
// here is contract : breaking changes require a major bump.

import { describe, expect, it, vi } from "vitest";

import { PrismScene } from "../../src/scene/prism-scene";
import type { SceneJson } from "../../src/scene/prism-scene";

function makeScene(): SceneJson {
  return {
    scene_id: "demo",
    state: { "score.value": 0, "headline.text": "Hello" },
    html: `
      <div data-solar-host>
        <h1 data-anim-id="headline" data-anim-path="headline.text">Hello</h1>
        <span data-anim-path="score.value">0</span>
      </div>
    `,
    animations: {
      Reveal: {
        patches: [
          { path: "headline.text", value: "Welcome" },
        ],
      },
      "Score Update": {
        patches: [
          {
            path: "score.value",
            value: "${param.score_to}" as unknown as number,
            action: {
              kind: "count-up",
              params: { from: 0, to: "${param.score_to}" },
              duration_ms: 50,
            },
          },
        ],
      },
    },
  };
}

describe("PrismScene / public API", () => {
  it("throws if sceneJson is missing", () => {
    expect(() => new PrismScene({ sceneJson: undefined as never })).toThrow();
  });

  it("mounts, binds DOM, applies initial state, then unmounts cleanly", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const scene = new PrismScene({ sceneJson: makeScene() });
    scene.mount(target);
    const headline = target.querySelector('[data-anim-path="headline.text"]');
    expect(headline?.textContent).toBe("Hello");
    scene.unmount();
    expect(target.querySelector("[data-solar-root]")).toBeNull();
    target.remove();
  });

  it("rejects double mount", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const scene = new PrismScene({ sceneJson: makeScene() });
    scene.mount(target);
    expect(() => scene.mount(target)).toThrow(/already mounted/);
    scene.unmount();
    target.remove();
  });

  it("plays a named animation, updates bound DOM, and emits completed", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const scene = new PrismScene({ sceneJson: makeScene() });
    scene.mount(target);

    const started = vi.fn();
    const done = vi.fn();
    scene.on("animation:start", started);
    scene.on("animation:completed", done);

    await scene.playAnimation("Reveal");
    expect(started).toHaveBeenCalledWith(
      expect.objectContaining({ asset_id: "Reveal" }),
    );
    expect(done).toHaveBeenCalledWith(
      expect.objectContaining({ asset_id: "Reveal" }),
    );

    const headline = target.querySelector('[data-anim-path="headline.text"]');
    expect(headline?.textContent).toBe("Welcome");

    scene.unmount();
    target.remove();
  });

  it("emits animation:error and rejects when the asset is unknown", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const scene = new PrismScene({ sceneJson: makeScene() });
    scene.mount(target);

    const err = vi.fn();
    scene.on("animation:error", err);

    await expect(scene.playAnimation("NopeNope")).rejects.toThrow(/not found/);
    expect(err).toHaveBeenCalled();

    scene.unmount();
    target.remove();
  });

  it("interpolates ${param.*} placeholders into action params", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const scene = new PrismScene({ sceneJson: makeScene() });
    scene.mount(target);

    await scene.playAnimation("Score Update", { score_to: 1891 });
    expect(scene._getStoreSnapshot()["score.value"]).toBe(1891);

    scene.unmount();
    target.remove();
  });

  it("forbids concurrent plays of the same asset id", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const scene = new PrismScene({
      sceneJson: {
        animations: {
          Long: {
            patches: [
              {
                path: "n",
                value: 100,
                action: {
                  kind: "count-up",
                  params: { from: 0, to: 100 },
                  duration_ms: 500,
                },
              },
            ],
          },
        },
      },
    });
    scene.mount(target);

    const first = scene.playAnimation("Long");
    await expect(scene.playAnimation("Long")).rejects.toThrow(/already playing/);
    scene.stopAnimation("Long");
    await first.catch(() => undefined);

    scene.unmount();
    target.remove();
  });

  it("setScene swaps state and re-binds the DOM", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const scene = new PrismScene({ sceneJson: makeScene() });
    scene.mount(target);

    scene.setScene({
      state: { greeting: "Bonjour" },
      html: `<p data-anim-path="greeting">Bonjour</p>`,
    });
    const p = target.querySelector('[data-anim-path="greeting"]');
    expect(p?.textContent).toBe("Bonjour");

    scene.unmount();
    target.remove();
  });

  it("off() removes a registered handler", async () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const scene = new PrismScene({ sceneJson: makeScene() });
    scene.mount(target);

    const h = vi.fn();
    scene.on("animation:completed", h);
    scene.off("animation:completed", h);
    await scene.playAnimation("Reveal");
    expect(h).not.toHaveBeenCalled();

    scene.unmount();
    target.remove();
  });

  it("connectToOrion is a no-op in mockMode", () => {
    const target = document.createElement("div");
    document.body.appendChild(target);
    const scene = new PrismScene({
      sceneJson: makeScene(),
      mockMode: true,
    });
    scene.mount(target);
    expect(() =>
      scene.connectToOrion({ url: "wss://example/orion", token: "t" }),
    ).not.toThrow();
    scene.disconnectFromOrion();
    scene.unmount();
    target.remove();
  });
});
