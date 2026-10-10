import { disconnectVisionSession } from "./vision-presenter";
import { createPeerViewerFromInjection } from "@lumencast/runtime";
import type { Operation } from "fast-json-patch";
import jsonPatch from "fast-json-patch";
import {
  BrowserLSDP,
  type IncomingContext,
} from "../../vendor/lsdp-native-browser/src/browser.js";
import { nativeTreeHash } from "../internal/native-tree";
import { NativeState } from "../internal/native-state";
import {
  NativeWorkerClient,
  verifiedNativeWorkerState,
} from "./native-worker-client";
import { scalarOperations } from "../internal/native-stream";
import {
  defaultsPatch,
  NativeSceneAssets,
  requireLSML,
  type LSMLDocument,
} from "../scenes/native-document";
import { presentationFeedback } from "./control-feedback";
import { FramePatches } from "./frame-patches";
import { NativeSceneFrames } from "./native-scene-frames";
import { createCaptureResolver } from "../sources/capture";
import { createPeerSources } from "../sources/peers";
import type { MountOptions, SolarToken } from "../types";
import { CaptureStreamPool, LiveMediaController } from "./live-media";
import {
  VisionAnimations,
  animationDocument,
  animationPatch,
} from "./animations";
import {
  activateVisionScene,
  type VisionSceneHandle,
} from "./vision-presenter";

interface Change {
  kind: "change" | "applied_change";
  sequence: number;
  mutation: {
    format: string;
    id: string;
    target: string;
    beforeHash: string;
    afterHash?: string;
    operations: Operation[];
  };
  receipt: {
    transactionId: string;
    target: string;
    level: string;
    stateHash?: string;
  };
}

/** Native binary transport → authoritative in-memory LSML → the same Vision presenter. */
export class NativeLsdpRuntime {
  private patches: FramePatches<{
    detail: Record<string, unknown>;
    check: () => void;
    document: LSMLDocument;
  }> | null = null;
  private visualQueue: Promise<void> = Promise.resolve();
  private readonly animations = new VisionAnimations(
    async (frames) => {
      const document = this.document;
      await this.visual(async () => {
        if (
          !this.active ||
          !document ||
          this.document !== document ||
          !this.current
        )
          return;
        await this.current.scene.applyPatch(
          animationPatch(document, frames, true),
        );
      });
    },
    (error) => this.report(error),
  );
  private visual<T>(action: () => Promise<T>): Promise<T> {
    const work = this.visualQueue.then(action);
    this.visualQueue = work.then(
      () => {},
      () => {},
    );
    return work;
  }
  private active = false;
  private peer: BrowserLSDP | null = null;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private delay = 250;
  private abort: AbortController | null = null;
  private token: SolarToken;
  private document: LSMLDocument | null = null;
  private presentedDocument: LSMLDocument | null = null;
  private nativeState: Pick<NativeState, "value" | "stateHash"> | null = null;
  private hasSnapshot = false;
  private hash: string | null = null;
  private sequence: number | null = null;
  private assets: NativeSceneAssets | null = null;
  private readonly frames: NativeSceneFrames;
  private finalizedPresentation: string | null = null;
  private presentation: {
    id: string;
    document: LSMLDocument;
    scene: VisionSceneHandle;
    assets: NativeSceneAssets;
    committed: boolean;
    finalized?: boolean;
    previous: { scene: VisionSceneHandle; media: LiveMediaController } | null;
    previousDocument: LSMLDocument | null;
    previousAssets: NativeSceneAssets | null;
  } | null = null;
  private current: {
    scene: VisionSceneHandle;
    media: LiveMediaController;
  } | null = null;
  private snapshot: {
    resolve: () => void;
    reject: (error: unknown) => void;
  } | null = null;
  private readonly capturePool = new CaptureStreamPool();
  private readonly peers: ReturnType<typeof createPeerSources>;
  private readonly resolveCaptureDevice: ReturnType<
    typeof createCaptureResolver
  >;

  constructor(private readonly options: MountOptions) {
    this.token = options.token;
    this.frames = new NativeSceneFrames(
      options,
      (scene) => {
        if (this.current?.scene === scene)
          this.current.media.update(scene.mediaSources);
      },
      (error) => this.report(error),
      () => this.abort?.signal,
      (stage, start, extra) => this.measure(stage, start, extra),
    );
    this.peers = createPeerSources(options, createPeerViewerFromInjection);
    this.resolveCaptureDevice = createCaptureResolver(options);
  }

  private measure(stage: string, start: number, extra = {}): void {
    if (performance.getEntriesByName("solar:native-stage").length >= 64)
      performance.clearMeasures("solar:native-stage");
    performance.measure("solar:native-stage", {
      start,
      detail: {
        stage,
        sceneId: this.document?.scene_id,
        resource: this.options.nativeLSDP.resource,
        ...extra,
      },
    });
  }

  start(): void {
    if (this.active) return;
    this.active = true;
    void this.connect();
  }

  disconnect(): void {
    this.active = false;
    this.animations.dispose();
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.closePeer();
    if (this.presentation) {
      if (this.presentation.scene !== this.current?.scene)
        this.presentation.scene.dispose();
      if (
        this.presentation.previous &&
        this.presentation.previous !== this.current
      ) {
        this.presentation.previous.scene.dispose();
        this.presentation.previous.media.dispose();
      }
      this.presentation = null;
    }
    this.current?.media.dispose();
    this.current?.scene.dispose();
    disconnectVisionSession(this.options.target);
    this.current = null;
    this.document = null;
    this.presentedDocument = null;
    this.assets = null;
    this.hash = null;
    this.nativeState = null;
    this.peers.dispose();
    this.options.onStatus?.("disconnected");
  }

  setToken(token: SolarToken): void {
    this.token = token;
    if (!this.active) return;
    this.closePeer();
    this.reconnect();
  }

  private closePeer(): void {
    this.patches?.close();
    this.patches = null;
    this.abort?.abort();
    this.abort = null;
    this.snapshot?.reject(new Error("Native LSDP connection closed."));
    this.snapshot = null;
    const peer = this.peer;
    this.peer = null;
    peer?.close();
  }

  private reconnect(): void {
    if (!this.active || this.timer) return;
    this.options.onStatus?.("connecting");
    this.timer = setTimeout(() => {
      this.timer = null;
      void this.connect();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, 10_000);
  }

  private async connect(): Promise<void> {
    if (!this.active || this.abort) return;
    this.options.onStatus?.("connecting");
    const abort = new AbortController();
    this.abort = abort;
    try {
      const authToken =
        typeof this.token === "string" ? this.token : await this.token.fetch();
      abort.signal.throwIfAborted();
      const callbacks = {
        authToken,
        onTransaction: (value: unknown, context: IncomingContext) =>
          this.receive(value, context, peer, abort.signal),
        onIncomingFailed: (_context: IncomingContext, error: Error) =>
          this.fail(peer, error),
        onClose: (error: Error) => this.fail(peer, error),
      };
      const peer: BrowserLSDP =
        typeof Worker === "function"
          ? new NativeWorkerClient(
              this.options.nativeLSDP.url,
              callbacks,
              this.options.nativeLSDP.resource,
              this.options.nativeLSDP.selector,
            )
          : new BrowserLSDP(this.options.nativeLSDP.url, callbacks);
      this.peer = peer;
      this.patches = new FramePatches(
        async (patch, receipts) => {
          await this.visual(async () => {
            receipts.forEach((receipt) => receipt.check());
            await this.current!.scene.applyPatch(patch);
            receipts.forEach((receipt) => receipt.check());
            const last = receipts.at(-1)!.detail;
            this.presentedDocument = receipts.at(-1)!.document;
            for (const receipt of receipts)
              this.options.target.dispatchEvent(
                new CustomEvent("solar:lsdp-applied", {
                  detail: {
                    ...receipt.detail,
                    presentation: {
                      throughSequence: last.sequence,
                      stateHash: last.stateHash,
                      mutationCount: receipts.length,
                    },
                  },
                }),
              );
          });
        },
        (error) => this.fail(peer, error),
      );
      await peer.ready;
      abort.signal.throwIfAborted();
      await this.readSubscribe(peer, abort.signal);
      abort.signal.throwIfAborted();
      this.delay = 250;
      this.options.onStatus?.("live");
    } catch (error) {
      if (!abort.signal.aborted) {
        this.report(error);
        this.closePeer();
        this.reconnect();
      }
    }
  }

  private async readSubscribe(
    peer: BrowserLSDP,
    signal: AbortSignal,
  ): Promise<void> {
    // Same-connection catch-up also serves explicit native resync notifications.
    for (let attempt = 0; attempt < 4; attempt++) {
      const ready = new Promise<void>((resolve, reject) => {
        this.snapshot = { resolve, reject };
      });
      void ready.catch(() => {});
      await peer.transaction(
        { kind: "state.read", target: this.options.nativeLSDP!.resource },
        { signal },
      );
      await ready;
      try {
        await peer.transaction(
          {
            kind: "subscribe",
            target: this.options.nativeLSDP!.resource,
            stateHash: this.hash,
          },
          { signal },
        );
        break;
      } catch (error) {
        if (
          attempt === 3 ||
          !(error instanceof Error) ||
          !("code" in error) ||
          error.code !== "BASE_MISMATCH"
        )
          throw error;
        signal.throwIfAborted();
      }
    }
  }

  private fail(peer: BrowserLSDP, error: unknown): void {
    if (this.peer !== peer || !this.active) return;
    this.report(error);
    this.closePeer();
    this.reconnect();
  }

  private async receive(
    value: unknown,
    context: IncomingContext,
    peer: BrowserLSDP,
    signal: AbortSignal,
  ): Promise<unknown> {
    signal = AbortSignal.any([signal, context.signal]);
    const check = (): void => {
      signal.throwIfAborted();
      context.signal.throwIfAborted();
      if (!this.active || this.peer !== peer)
        throw new Error("Stale native LSDP delivery.");
    };
    check();
    const resource = this.options.nativeLSDP!.resource;
    if (context.metadata.target !== resource)
      throw new Error("Unexpected native resource.");
    if (context.metadata.profile === "lsdp.state.read/1") {
      if (!this.snapshot) throw new Error("Unexpected native snapshot.");
      try {
        await this.patches?.flush();
        const verified = verifiedNativeWorkerState(context);
        if (peer instanceof NativeWorkerClient && !verified)
          throw new Error("Verified worker snapshot required.");
        const state = verified ?? NativeState.from(value);
        const handled = await this.visual(() =>
          this.transition(state.value, check, signal),
        );
        const document = handled
          ? this.document
          : this.selectedDocument(state.value);
        const hash = state.stateHash;
        if (handled) {
          /* coordinated presentation owns the visible frame */
        } else if (document) {
          const operations =
            this.presentedDocument &&
            this.presentedDocument.scene_id === document.scene_id &&
            this.presentedDocument.scene_version === document.scene_version
              ? jsonPatch.compare(this.presentedDocument, document)
              : null;
          const patch = operations ? defaultsPatch(operations, document) : null;
          if (
            patch &&
            this.current &&
            this.current.scene.canApplyPatch?.(patch) !== false
          ) {
            await this.visual(async () => {
              check();
              await this.current!.scene.applyPatch(patch);
            });
          } else
            await this.visual(() =>
              this.render(
                animationDocument(document, this.animations.current(document)),
                check,
                signal,
              ),
            );
        } else {
          this.animations.clear();
          await this.current?.media.pause();
          await this.current?.scene.flush?.();
          this.current?.media.dispose();
          this.current?.scene.dispose();
          await this.current?.scene.flush?.();
          this.current = null;
          this.assets = null;
        }
        check();
        this.document = document;
        this.presentedDocument = document;
        if (document) this.animations.update(document);
        this.nativeState = state;
        this.hasSnapshot = true;
        this.hash = hash;
        this.sequence = null;
        if (document) this.reserved(document);
        this.snapshot.resolve();
        this.snapshot = null;
        return { level: "applied", stateHash: hash };
      } catch (error) {
        this.snapshot?.reject(error);
        throw error;
      }
    }
    if (
      context.metadata.profile !== "lsdp.state.subscription/1" ||
      !this.hasSnapshot
    )
      throw new Error("Unexpected native notification.");
    const resync = value as { kind?: string; target?: string; reason?: string };
    if (resync.kind === "resync") {
      if (resync.target !== resource || typeof resync.reason !== "string")
        throw new Error("Invalid native resync notification.");
      this.options.target.dispatchEvent(
        new CustomEvent("solar:lsdp-resync", {
          detail: { target: resource, reason: resync.reason },
        }),
      );
      await this.readSubscribe(peer, signal);
      check();
      return { level: "received" };
    }
    const event = value as Change;
    const application = event.kind === "applied_change";
    const mutation = event.mutation;
    if (
      (!application && event.kind !== "change") ||
      mutation?.format !== (application ? "lsdp.apply/1" : "lsdp.tree/1") ||
      mutation.target !== resource ||
      event.receipt?.target !== resource ||
      event.receipt?.transactionId !== mutation.id ||
      !Number.isSafeInteger(event.sequence) ||
      (this.sequence !== null && event.sequence <= this.sequence) ||
      mutation.beforeHash !== this.hash
    )
      throw new Error(
        "Invalid native event or resource requires resynchronization.",
      );
    if (
      !Array.isArray(mutation.operations) ||
      mutation.operations.some(
        (op) => !["add", "remove", "replace", "test"].includes(op.op),
      )
    )
      throw new Error("Unsupported native operation.");
    const classifiedAt = performance.now();
    const verified = verifiedNativeWorkerState(context);
    if (peer instanceof NativeWorkerClient && !verified)
      throw new Error("Verified worker change required.");
    const state =
      verified ??
      (this.nativeState instanceof NativeState
        ? this.nativeState.patch(mutation.operations)
        : (() => {
            throw new Error("Native snapshot required.");
          })());
    const resourceState = state.value;
    let next = this.selectedDocument(resourceState);
    const hash = state.stateHash;
    if (
      !application &&
      (hash !== mutation.afterHash || hash !== event.receipt.stateHash)
    )
      throw new Error("Native event integrity check failed.");
    const selector = this.options.nativeLSDP!.selector;
    const prefix = selector ? `/${selector}` : "";
    const selectedOperations = selector
      ? (mutation.operations
          .filter(
            (op) =>
              op.path === "" ||
              op.path === prefix ||
              op.path.startsWith(`${prefix}/`),
          )
          .map((op) => ({
            ...op,
            path: op.path === "" ? "" : op.path.slice(prefix.length),
          })) as Operation[])
      : mutation.operations;
    const changed = selectedOperations.length > 0;
    // Absolute native assignments also carry coordinator metadata. Compare the
    // accepted document before treating the assignment as a structural change;
    // finalization must not mount the just-prepared Vision scene a second time.
    const patch = next
      ? (defaultsPatch(selectedOperations, next) ??
        (this.presentedDocument?.scene_id === next.scene_id &&
        this.presentedDocument.scene_version === next.scene_version
          ? defaultsPatch(jsonPatch.compare(this.presentedDocument, next), next)
          : null))
      : null;
    this.measure("classify", classifiedAt);
    // Only replaceable scalar state can share a frame. Native transport receives
    // an honest "received" receipt; presentation receipts still follow Vision.
    // Commands, structure and coordinated lane transitions remain synchronous.
    const scalar = scalarOperations(selectedOperations);
    if (
      scalar &&
      patch &&
      this.current &&
      this.patches &&
      this.current.scene.canApplyPatch?.(patch) !== false &&
      this.document?.scene_id === next?.scene_id &&
      this.document?.scene_version === next?.scene_version &&
      !next?.["x-solar-transition"] &&
      !this.presentation
    ) {
      this.document = next;
      this.nativeState = state;
      this.hash = hash;
      this.sequence = event.sequence;
      const detail = {
        transactionId: mutation.id,
        target: resource,
        sequence: event.sequence,
        stateHash: hash,
        render: "patch",
      };
      this.patches.add(patch, { detail, check, document: next! });
      this.options.target.dispatchEvent(
        new CustomEvent("solar:lsdp-received", { detail }),
      );
      return { level: "received", transactionId: mutation.id, stateHash: hash };
    }
    await this.patches?.flush();
    let rendering = "unchanged";
    const coordinated =
      changed &&
      (await this.visual(() => this.transition(resourceState, check, signal)));
    if (coordinated) {
      next = this.document;
      rendering = "coordinated";
    } else if (!changed) {
      // Changes to the other physical lane/session are acknowledged without rendering.
    } else if (!next) {
      rendering = "document";
      this.animations.clear();
      await this.current?.media.pause();
      await this.current?.scene.flush?.();
      this.current?.media.dispose();
      this.current?.scene.dispose();
      await this.current?.scene.flush?.();
      this.current = null;
      this.assets = null;
    } else if (
      next &&
      this.document &&
      (next === this.document || hash === this.hash)
    ) {
      rendering = "unchanged";
    } else if (
      patch &&
      this.current &&
      this.current.scene.canApplyPatch?.(patch) !== false &&
      this.document?.scene_id === next.scene_id &&
      this.document?.scene_version === next.scene_version
    ) {
      rendering = "patch";
      await this.visual(async () => {
        check();
        await this.current!.scene.applyPatch(patch);
      });
    } else {
      rendering = "document";
      await this.visual(() =>
        this.render(
          animationDocument(next!, this.animations.current(next!)),
          check,
          signal,
        ),
      );
    }
    check();
    this.document = next;
    this.presentedDocument = next;
    if (next && changed) this.animations.update(next);
    this.nativeState = state;
    this.hash = hash;
    this.sequence = event.sequence;
    if (next && changed) this.reserved(next);
    // This subscriber ACK follows Vision's frame submission. The writer's
    // earlier authoritative-server ACK alone does not prove rendering.
    const detail = {
      transactionId: mutation.id,
      target: resource,
      sequence: event.sequence,
      stateHash: hash,
      render: rendering,
    };
    this.options.target.dispatchEvent(
      new CustomEvent("solar:lsdp-applied", { detail }),
    );
    return application
      ? { level: "applied", transactionId: mutation.id }
      : { level: "applied", stateHash: hash };
  }

  private selectedDocument(state: unknown): LSMLDocument | null {
    const selector = this.options.nativeLSDP!.selector;
    if (!selector) {
      if (state === null) return null;
      const document = requireLSML(state);
      if (!document["x-solar-transition"]) return document;
      const clean = structuredClone(document);
      delete clean["x-solar-transition"];
      return clean;
    }
    if (!state || typeof state !== "object" || Array.isArray(state))
      throw new Error("Native scene collection required.");
    const value = Object.hasOwn(state, selector)
      ? (state as Record<string, unknown>)[selector]
      : null;
    return value === null ? null : requireLSML(value);
  }

  private async transition(
    state: unknown,
    check: () => void,
    signal: AbortSignal,
  ): Promise<boolean> {
    const resource = this.options.nativeLSDP.resource;
    const lane =
      resource === "solar/program"
        ? "program"
        : resource === "solar/preview"
          ? "preview"
          : null;
    if (!lane || !state || typeof state !== "object") return false;
    const transition = (state as Record<string, unknown>)[
      "x-solar-transition"
    ] as
      | {
          request_id: string;
          phase: string;
          source?: unknown;
        }
      | undefined;
    if (!transition) {
      // Orion seeds its admitted mirror while Blue is still behind the gate.
      // Finalization owns the retained compensation frame, not this source seed.
      if (this.presentation?.finalized) {
        const pending = this.presentation;
        if (pending.previous && pending.previous.scene !== this.current?.scene)
          this.frames.retire(pending.previous.scene);
        if (pending.previous?.media !== this.current?.media)
          pending.previous?.media.dispose();
        this.finalizedPresentation = pending.id;
        this.presentation = null;
      } else if (this.presentation?.committed) return true;
      else if (this.presentation) {
        this.presentation.scene.dispose();
        this.presentation = null;
      }
      return false;
    }
    if (
      !/^[a-zA-Z0-9_:-]{1,128}$/.test(transition.request_id) ||
      !["prepare", "commit", "finalize", "abort"].includes(transition.phase)
    )
      throw new Error("SOLAR_TRANSITION_INVALID");
    const ack = async (phase: string, error?: string): Promise<void> => {
      const started = performance.now();
      check();
      const document = this.presentation?.document ?? this.document;
      await presentationFeedback(
        this.options.nativeLSDP.url,
        lane,
        {
          request_id: transition.request_id,
          transition_phase: transition.phase,
          phase,
          scene_id: document?.scene_id ?? null,
          scene_version: document?.scene_version ?? null,
          ...(error ? { error } : {}),
        },
        signal,
      );
      this.measure("feedback", started, { phase });
    };
    try {
      if (
        transition.phase === "finalize" &&
        this.finalizedPresentation === transition.request_id
      ) {
        await ack("active");
        return true;
      }
      // A fresh renderer can join after commit. Its authoritative snapshot
      // carries the admitted source, so it reconstructs that confirmed stage.
      if (
        !this.presentation &&
        !this.hasSnapshot &&
        ["commit", "finalize"].includes(transition.phase)
      ) {
        const document = requireLSML(
          transition.source ?? this.selectedDocument(state),
        );
        const frame = await this.frames.prepare(
          document,
          check,
          signal,
          this.assets,
        );
        this.presentation = {
          id: transition.request_id,
          document,
          ...frame,
          committed: false,
          previous: this.current,
          previousDocument: this.document,
          previousAssets: this.assets,
        };
      }
      if (transition.phase === "prepare") {
        const document = requireLSML(transition.source);
        if (this.presentation?.id === transition.request_id) {
          if (
            nativeTreeHash(this.presentation.document) !==
            nativeTreeHash(document)
          )
            throw new Error("SOLAR_TRANSITION_ID_REUSED");
        } else {
          if (this.presentation) throw new Error("SOLAR_TRANSITION_BUSY");
          await this.current?.media.pause();
          await this.current?.scene.flush?.();
          try {
            const frame = await this.frames.prepare(
              document,
              check,
              signal,
              this.assets,
            );
            this.presentation = {
              id: transition.request_id,
              document,
              ...frame,
              committed: false,
              previous: this.current,
              previousDocument: this.document,
              previousAssets: this.assets,
            };
          } finally {
            this.current?.media.resume();
          }
        }
        await ack("prepared");
      } else if (transition.phase === "abort") {
        if (this.finalizedPresentation === transition.request_id)
          throw new Error("SOLAR_TRANSITION_FINALIZED");
        const pending = this.presentation;
        if (pending && pending.id !== transition.request_id)
          throw new Error("SOLAR_TRANSITION_ID_MISMATCH");
        // A subscriber joining after compensation receives the restored source
        // with abort metadata. Present that source before confirming recovery.
        if (!pending && !this.hasSnapshot) {
          const restored = this.selectedDocument(state);
          if (restored) {
            await this.render(restored, check, signal);
            this.document = restored;
          }
        }
        if (pending) {
          await this.current?.media.pause();
          await this.current?.scene.flush?.();
          if (pending.committed) {
            pending.previous?.scene.activate();
            if (this.current?.media !== pending.previous?.media)
              this.current?.media.dispose();
            this.current = pending.previous;
            this.document = pending.previousDocument;
            this.assets = pending.previousAssets;
            if (this.current)
              this.current.media.update(this.current.scene.mediaSources);
          }
          pending.scene.dispose();
          this.presentation = null;
          this.current?.media.resume();
        }
        await ack("aborted");
      } else {
        const pending = this.presentation;
        if (!pending || pending.id !== transition.request_id)
          throw new Error("SOLAR_TRANSITION_NOT_PREPARED");
        if (!pending.committed) {
          if (transition.phase !== "commit" && this.hasSnapshot)
            throw new Error("SOLAR_TRANSITION_NOT_COMMITTED");
          await this.current?.media.pause();
          await this.current?.scene.flush?.();
          check();
          const media =
            this.current?.media ??
            new LiveMediaController({
              liveAudio: this.options.liveAudio === true,
              resolveCaptureDevice: this.resolveCaptureDevice,
              peers: this.peers,
              capturePool: this.capturePool,
              onError: (error) => this.options.onError?.(error),
              getScene: () => this.current?.scene ?? pending.scene,
            });
          pending.scene.activate(); // old frame remains available until Orion finalizes.
          pending.previous?.scene.deactivate?.();
          this.current = { scene: pending.scene, media };
          this.assets = pending.assets;
          this.document = pending.document;
          media.update(pending.scene.mediaSources);
          media.resume();
          pending.committed = true;
          this.reserved(pending.document);
        }
        if (transition.phase === "finalize") {
          // Confirm active before discarding the compensation frame. Lost feedback
          // can be replayed without remounting or rerunning Blue.
          await ack("active");
          // Retain compensation until the coordinator removes the metadata.
          // A lost active receipt can still be reconciled or aborted safely.
          pending.finalized = true;
        } else await ack("committed");
      }
    } catch (error) {
      if (signal.aborted) throw error;
      await ack(
        "failed",
        error instanceof Error ? error.message : String(error),
      );
      this.report(error);
    }
    return true;
  }

  private async render(
    document: LSMLDocument,
    check: () => void,
    signal: AbortSignal,
  ): Promise<void> {
    let next: VisionSceneHandle | null = null;
    let media: LiveMediaController | null = this.current?.media ?? null;
    const reusedMedia = media !== null;
    const previous = this.current;
    let committed = false;
    try {
      // Vision's main-thread WebGL canvases must not overlap old camera renders
      // with staging/teardown of the next engine. Tracks stay acquired.
      await previous?.media.pause();
      await previous?.scene.flush?.();
      check();
      const frame = await this.frames.prepare(
        document,
        check,
        signal,
        this.assets,
      );
      next = frame.scene;
      const assets = frame.assets;
      check();
      media ??= new LiveMediaController({
        liveAudio: this.options.liveAudio === true,
        resolveCaptureDevice: this.resolveCaptureDevice,
        peers: this.peers,
        capturePool: this.capturePool,
        onError: (error) => this.options.onError?.(error),
        getScene: () => this.current?.scene ?? next,
      });
      activateVisionScene(next, previous?.scene, true);
      committed = true;
      this.current = { scene: next, media };
      this.assets = assets;
      media.update(next.mediaSources);
      await previous?.scene.flush?.();
      if (previous && previous.scene !== next)
        this.frames.retire(previous.scene);
      check();
      media.resume();
      if (previous && previous.media !== media) previous.media.dispose();
    } catch (error) {
      if (!committed) {
        if (!reusedMedia) media?.dispose();
        next?.dispose();
      }
      throw error;
    } finally {
      // Also resume the last accepted scene if staging failed or was cancelled.
      this.current?.media.resume();
    }
  }

  private reserved(document: LSMLDocument): void {
    const slots: Record<string, string> = {};
    const defaults = document.defaults ?? {};
    for (const [key, value] of Object.entries(defaults)) {
      if (key.startsWith("__cam.slots.") && typeof value === "string" && value)
        slots[key.slice(12)] = value;
    }
    const raw = defaults["__cam.viewer"];
    let viewer: unknown = raw;
    if (typeof raw === "string") {
      try {
        viewer = JSON.parse(raw);
      } catch {
        viewer = undefined;
      }
    }
    this.peers.onReservedLeaves?.({
      ...(viewer !== undefined ? { viewer } : {}),
      slots,
    });
  }

  private report(error: unknown): void {
    this.options.onError?.({
      code: "INTERNAL",
      message: `Native LSDP: ${error instanceof Error ? error.message : String(error)}`,
      recoverable: true,
    });
  }
}
