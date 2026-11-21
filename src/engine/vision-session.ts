import type { CanvasPresentation } from "./canvas-presentation";
import type { VisionPresenterMessage } from "./vision-contracts";

/** Target-owned persistent engines and disconnect fences shared by their scene handles. */
export interface PresenterEvent {
  data: VisionPresenterMessage;
}

export interface VisionPresenter {
  addEventListener(
    type: "message",
    listener: (event: PresenterEvent) => void,
  ): void;
  postMessage(request: Record<string, unknown>): void;
  terminate(): void;
  flush(): Promise<void>;
}

export interface PersistentVisionSession {
  layer: HTMLDivElement;
  canvas: HTMLCanvasElement;
  presentation: CanvasPresentation;
  presenter: VisionPresenter | null;
  lifetime: PersistentVisionLifetime;
  sequence: number;
  owner: object | null;
  closed: boolean;
  engineReady: boolean;
  fontsReady: boolean;
  nativeComposition?: boolean;
  admittedFonts: Set<string>;
  onMessage: (event: PresenterEvent) => void;
  retire: (error: Error) => void;
}

export interface PersistentVisionLifetime {
  closed: boolean;
  signal: AbortSignal;
  close(error: Error): void;
}

export const visionSessions = new WeakMap<
  HTMLElement,
  PersistentVisionSession
>();
// A live handle owns its engine until retirement. Reuse only cleared idle engines;
// preparing a candidate must never overwrite the accepted scene or its front.
export const visionSessionPools = new WeakMap<
  HTMLElement,
  Set<PersistentVisionSession>
>();
export const sceneLoads = new WeakMap<HTMLElement, Promise<void>>();
export const visionLifetimes = new WeakMap<
  HTMLElement,
  PersistentVisionLifetime
>();

/** Read the cap from Vision's already initialized, session-owned WebGL2 context. */
export function visionMaxTextureSize(target: HTMLElement): number {
  const session = visionSessions.get(target);
  if (!session || session.closed || !session.presenter || !session.fontsReady)
    throw new Error("NATIVE_COMPOSITION_VISION_SESSION_UNAVAILABLE");
  // The presenter initializes this exact canvas as WebGL2 before the session is
  // marked ready. getContext therefore returns the owned context; this does not
  // create an auxiliary canvas or GPU context.
  const context = session.canvas.getContext("webgl2");
  if (!context || context.isContextLost())
    throw new Error("NATIVE_COMPOSITION_WEBGL2_CONTEXT_UNAVAILABLE");
  const limit = context.getParameter(context.MAX_TEXTURE_SIZE);
  if (!Number.isSafeInteger(limit) || limit < 1)
    throw new Error("NATIVE_COMPOSITION_TEXTURE_LIMIT_UNAVAILABLE");
  return limit;
}

export function disconnectedError(): Error {
  const error = new Error("Vision host session disconnected.");
  error.name = "AbortError";
  return error;
}

export function lifetimeFor(target: HTMLElement): PersistentVisionLifetime {
  const current = visionLifetimes.get(target);
  if (current && !current.closed) return current;

  const controller = new AbortController();
  const lifetime: PersistentVisionLifetime = {
    closed: false,
    signal: controller.signal,
    close(error) {
      if (lifetime.closed) return;
      lifetime.closed = true;
      controller.abort(error);
    },
  };
  visionLifetimes.set(target, lifetime);
  return lifetime;
}

export function isCurrentLifetime(
  target: HTMLElement,
  lifetime: PersistentVisionLifetime,
): boolean {
  return !lifetime.closed && visionLifetimes.get(target) === lifetime;
}

export function assertCurrentLifetime(
  target: HTMLElement,
  lifetime: PersistentVisionLifetime,
): void {
  if (!isCurrentLifetime(target, lifetime)) throw disconnectedError();
}

export function awaitLifetime<T>(
  target: HTMLElement,
  lifetime: PersistentVisionLifetime | null,
  pending: Promise<T>,
): Promise<T> {
  if (!lifetime) return pending;
  if (!isCurrentLifetime(target, lifetime)) {
    void pending.catch(() => {});
    return Promise.reject(disconnectedError());
  }
  return new Promise<T>((resolve, reject) => {
    let context: {
      target: HTMLElement;
      lifetime: PersistentVisionLifetime;
    } | null = { target, lifetime };
    let signal: AbortSignal | null = lifetime.signal;
    let resolveResult: ((value: T) => void) | null = resolve;
    let rejectResult: ((reason?: unknown) => void) | null = reject;
    let onAbort: (() => void) | null = null;
    const cleanup = (): void => {
      if (signal && onAbort) signal.removeEventListener("abort", onAbort);
      signal = null;
      onAbort = null;
      context = null;
    };
    const finish = (succeeded: boolean, value: unknown): void => {
      if (!context) return;
      const resolveCurrent = resolveResult;
      const rejectCurrent = rejectResult;
      resolveResult = null;
      rejectResult = null;
      cleanup();
      if (succeeded) resolveCurrent?.(value as T);
      else rejectCurrent?.(value);
    };
    onAbort = () => finish(false, signal?.reason ?? disconnectedError());
    signal.addEventListener("abort", onAbort, { once: true });
    pending.then(
      (value) => {
        const active = context;
        if (!active) return;
        try {
          assertCurrentLifetime(active.target, active.lifetime);
          finish(true, value);
        } catch (error) {
          finish(false, error);
        }
      },
      (error: unknown) => finish(false, error),
    );
    if (signal.aborted) onAbort();
  });
}
