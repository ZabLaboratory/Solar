import { afterEach, expect, it, vi } from "vitest";
import {
  mountVisionScene,
  disconnectVisionSession,
} from "../../src/engine/vision-presenter";
import { nativeManifest } from "../helpers/native-source";
const fake = vi.hoisted(() => ({
  listener: null as
    | null
    | ((event: { data: { type: string; seq: number } }) => void),
  held: null as null | Record<string, unknown>,
  hold: false,
}));
vi.mock("http://localhost:3000/vision/ui/mainpresenter.mjs", () => ({
  createMainThreadPresenter: (canvas: HTMLCanvasElement) => ({
    addEventListener: (_type: string, listener: typeof fake.listener) => {
      fake.listener = listener;
    },
    postMessage: (r: Record<string, unknown>) => {
      canvas.width = 1920;
      canvas.height = 1080;
      if (r.type === "load" && fake.hold) {
        fake.held = r;
        return;
      }
      queueMicrotask(() =>
        fake.listener?.({
          data: {
            type: r.type === "init-empty" ? "engine-ready" : "frame-submitted",
            seq: r.seq as number,
          },
        }),
      );
    },
    flush: async () => {},
    terminate: () => {},
  }),
}));
afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  fake.hold = false;
  fake.held = null;
});
it("keeps the active front surface visible throughout a delayed structural load", async () => {
  document.head.innerHTML = '<base href="http://localhost:3000/">';
  vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({
    drawImage: vi.fn(),
  } as unknown as CanvasRenderingContext2D);
  const target = document.createElement("div");
  document.body.append(target);
  const delivery = {
    format: "lsmlz" as const,
    data: new Uint8Array([1]),
    revision: 1,
    sourceDigest: "unit-source",
    assets: new Map<string, Uint8Array>(),
    blueManifest: nativeManifest("scene", "v1"),
    sceneId: "scene",
    sceneVersion: "v1",
  };
  const pack = {
    data: delivery.data,
    sceneVersion: "v1",
    surface: { width: 1920, height: 1080 },
    installationFonts: async function* () {},
  };
  const first = await mountVisionScene(
    target,
    delivery,
    {},
    () => {},
    () => {},
    pack,
    true,
  );
  first.activate();
  const layer = target.firstElementChild as HTMLElement;
  const pixels = layer.lastElementChild;
  fake.hold = true;
  const loading = mountVisionScene(
    target,
    { ...delivery, sceneVersion: "v2" },
    {},
    () => {},
    () => {},
    { ...pack, sceneVersion: "v2" },
    true,
  );
  await vi.waitFor(() => expect(fake.held).not.toBeNull());
  expect(layer.style.opacity).toBe("1");
  expect(target.firstElementChild).toBe(layer);
  expect(layer.lastElementChild).toBe(pixels);
  fake.listener?.({
    data: { type: "frame-submitted", seq: fake.held!.seq as number },
  });
  const second = await loading;
  second.activate();
  first.dispose();
  expect(layer.style.opacity).toBe("1");
  second.dispose();
  disconnectVisionSession(target);
});
