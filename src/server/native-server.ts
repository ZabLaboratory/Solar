import { windowsRegisteredFonts } from "./windows-fonts";
import {
  InstallationFonts,
  type InstallationFontEndpoint,
} from "./installation-fonts";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { arch, platform, homedir } from "node:os";
import { fileURLToPath } from "node:url";
import { BrowserLSDP } from "../../vendor/lsdp-native-browser/src/browser.js";
import { nativeTreeHash, validateNativeJSON } from "../internal/native-tree";
import { requireLSML } from "../scenes/native-document";
import type { Operation } from "fast-json-patch";
import { NativeState } from "../internal/native-state";

export const NATIVE_WIRE = "LSDP-TCP/2.0-draft2";
export interface ReceptionResource {
  type: "solar.lsml/1" | "orion.state/1";
  /** null means no scene has been selected. It is not a renderable fixture. */
  initial: unknown;
}
export interface ReceptionOptions {
  resources: Record<string, ReceptionResource>;
  origins: string[];
  /** Explicit development override. Installed hosts resolve the packaged binary. */
  binaryPath?: string;
  packageRoot?: string;
  timeoutMs?: number;
  probeIntervalMs?: number;
  onFailure?: (error: Error) => void;
  /** Automatic same-endpoint recovery. Scenes restart empty; producers republish. */
  recoveryAttempts?: number;
  onRecovery?: (event: {
    attempt: number;
    state: "recovering" | "ready";
  }) => void;
}
export interface ReceptionConnection {
  address: string;
  websocketUrl: string;
  pid: number;
  wire: typeof NATIVE_WIRE;
  resources: string[];
  fontCatalog?: InstallationFontEndpoint;
}
export interface NativeSnapshot {
  state: unknown;
  stateHash: string;
}
const targetPattern = /^[a-zA-Z0-9][a-zA-Z0-9._/-]{0,127}$/;
const requiredProfiles = [
  "lsdp.state.application/1",
  "lsdp.node.routing/1",
  "lsdp.state.read/1",
  "lsdp.transport.websocket/1",
];

export function receptionSettings(
  options: ReceptionOptions,
): Record<string, unknown> {
  const resources: Record<string, unknown> = {},
    links: Record<string, unknown> = {},
    inlets: Record<string, unknown> = {};
  if (!Object.keys(options.resources).length)
    throw new Error("LSDP_RESOURCES_REQUIRED");
  for (const [target, resource] of Object.entries(options.resources)) {
    if (
      !targetPattern.test(target) ||
      target.includes("//") ||
      !["solar.lsml/1", "orion.state/1"].includes(resource.type)
    )
      throw new Error("LSDP_RESOURCE_INVALID");
    if (resource.type === "solar.lsml/1" && resource.initial !== null)
      requireLSML(resource.initial);
    nativeTreeHash(resource.initial); // Reject nonportable JSON before starting a process.
    resources[target] = structuredClone(resource.initial);
    links[target] = {
      input: target,
      type: resource.type,
      mode: "state",
      require: "applied",
      maxOperations: 100_000,
      destinations: [{ endpoint: "local", target }],
    };
    inlets[target] = { type: resource.type, mode: "state" };
  }
  if (
    !options.origins.length ||
    options.origins.some((origin) => {
      const url = new URL(origin);
      return (
        url.origin !== origin ||
        url.protocol !== "http:" ||
        !["localhost", "127.0.0.1", "[::1]"].includes(url.hostname)
      );
    })
  )
    throw new Error("LSDP_LOCAL_ORIGIN_REQUIRED");
  return {
    listen: "127.0.0.1:0",
    resources,
    websocket: { listen: "127.0.0.1:0", origins: options.origins },
    topology: { links, inlets },
  };
}

export async function packagedNativeBinary(
  root = resolve(dirname(fileURLToPath(import.meta.url)), ".."),
): Promise<string> {
  const key = `${platform()}-${arch()}`;
  const manifest = JSON.parse(
    await readFile(resolve(root, "native/manifest.json"), "utf8"),
  );
  const entry = manifest.binaries?.[key];
  const filename = platform() === "win32" ? "lsdpd.exe" : "lsdpd";
  if (
    manifest.wire !== NATIVE_WIRE ||
    !/^[a-f0-9]{40}$/.test(manifest.source_revision) ||
    entry?.file !== `${key}/${filename}` ||
    !/^[a-f0-9]{64}$/.test(entry.sha256)
  )
    throw new Error("LSDP_NATIVE_PACKAGE_INVALID");
  const binary = resolve(root, "native", entry.file);
  const actual = createHash("sha256")
    .update(await readFile(binary))
    .digest("hex");
  if (actual !== entry.sha256)
    throw new Error("LSDP_NATIVE_BINARY_DIGEST_MISMATCH");
  return binary;
}

/** Owned by a system host (Prism main), never by Solar's browser renderer. */
export class SolarReceptionServer {
  private child: ChildProcessWithoutNullStreams | null = null;
  private connection: ReceptionConnection | null = null;
  private starting: Promise<ReceptionConnection> | null = null;
  private stopping: Promise<void> | null = null;
  private abort: AbortController | null = null;
  private monitor: ReturnType<typeof setInterval> | null = null;
  private installationFonts: InstallationFonts | null = null;
  private fontCatalog: InstallationFontEndpoint | undefined;
  private probing = false;
  private readonly settings: Record<string, unknown>;
  private readonly peers = new Set<BrowserLSDP>();
  private readonly watches = new Set<() => void>();
  private readonly recoveryListeners = new Set<() => void>();
  private wanted = false;
  private recovering: Promise<ReceptionConnection> | null = null;
  private epoch = 0;
  constructor(private readonly options: ReceptionOptions) {
    this.settings = receptionSettings(options);
  }

  start(): Promise<ReceptionConnection> {
    this.wanted = true;
    if (this.recovering) return this.recovering;
    if (this.starting) return this.starting;
    if (this.connection) return this.check().then(() => this.connection!);
    const operation = this.launch();
    this.starting = operation;
    void operation
      .finally(() => {
        if (this.starting === operation) this.starting = null;
      })
      .catch(() => {});
    return operation;
  }

  private async launch(): Promise<ReceptionConnection> {
    if (this.stopping) await this.stopping;
    const abort = new AbortController();
    this.abort = abort;
    try {
      const binary =
        this.options.binaryPath ??
        (await packagedNativeBinary(this.options.packageRoot));
      abort.signal.throwIfAborted();
      if (this.options.packageRoot && !this.installationFonts) {
        const data =
          process.env.LOCALAPPDATA ?? resolve(homedir(), ".local", "share");
        const fonts = new InstallationFonts(resolve(data, "Solar", "fonts"));
        const roots = [
          resolve(this.options.packageRoot, "host", "fonts"),
          resolve(this.options.packageRoot, "fonts"),
        ];
        if (platform() === "win32") {
          const windows = process.env.WINDIR ?? "C:/Windows";
          roots.push(
            resolve(windows, "Fonts"),
            resolve(data, "Microsoft", "Windows", "Fonts"),
            ...(await windowsRegisteredFonts(windows)),
          );
        }
        this.installationFonts = fonts;
        await fonts.prepare(roots);
        abort.signal.throwIfAborted();
        this.fontCatalog = await fonts.start(this.options.origins);
        abort.signal.throwIfAborted();
      }
      const child = spawn(binary, ["--settings", "-"], {
        stdio: "pipe",
        windowsHide: true,
      });
      this.child = child;
      let diagnostic = "";
      child.stderr.on("data", (bytes) => {
        diagnostic = (diagnostic + bytes).slice(-4096);
      });
      // Drain for the entire lifetime, including malformed diagnostics.
      const ready = await new Promise<ReceptionConnection>((yes, no) => {
        let pending = "",
          settled = false;
        const finish = (error?: Error, value?: ReceptionConnection): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          abort.signal.removeEventListener("abort", cancelled);
          if (error) no(error);
          else yes(value!);
        };
        const cancelled = (): void => finish(new Error("LSDP_START_CANCELLED"));
        const timer = setTimeout(
          () => finish(new Error("LSDP_START_TIMEOUT")),
          this.options.timeoutMs ?? 15_000,
        );
        abort.signal.addEventListener("abort", cancelled, { once: true });
        child.once("error", (error) => finish(error));
        child.once("exit", () => {
          finish(new Error(`LSDP_EXIT_BEFORE_READY: ${diagnostic}`));
          if (this.child === child && !abort.signal.aborted && this.connection)
            this.failed(new Error("LSDP_PROCESS_EXITED"));
        });
        child.stdout.on("data", (bytes) => {
          pending += bytes;
          if (pending.length > 65_536) {
            pending = "";
            finish(new Error("LSDP_READINESS_LIMIT"));
            return;
          }
          let end: number;
          while ((end = pending.indexOf("\n")) >= 0) {
            const line = pending.slice(0, end);
            pending = pending.slice(end + 1);
            try {
              const event = JSON.parse(line);
              if (event.event !== "listening") continue;
              if (
                !/^127\.0\.0\.1:\d+$/.test(event.address) ||
                !/^127\.0\.0\.1:\d+$/.test(event.websocket) ||
                !child.pid
              )
                throw new Error("LSDP_LISTENER_INVALID");
              finish(undefined, {
                address: event.address,
                websocketUrl: `ws://${event.websocket}/lsdp`,
                pid: child.pid,
                wire: NATIVE_WIRE,
                resources: Object.keys(this.options.resources),
                ...(this.fontCatalog ? { fontCatalog: this.fontCatalog } : {}),
              });
            } catch {
              finish(new Error("LSDP_READINESS_INVALID"));
            }
          }
        });
        child.stdin.on("error", (error) => finish(error));
        child.stdin.end(JSON.stringify(this.settings));
      });
      abort.signal.throwIfAborted();
      this.connection = ready;
      await this.check();
      // A renderer/producer can keep its URL when the child is replaced.
      this.settings.listen = ready.address;
      (this.settings.websocket as { listen: string }).listen = new URL(
        ready.websocketUrl,
      ).host;
      abort.signal.throwIfAborted();
      const interval = this.options.probeIntervalMs ?? 5000;
      if (interval > 0) {
        this.monitor = setInterval(() => {
          if (this.probing) return;
          this.probing = true;
          void this.check()
            .catch((error) => {
              if (!abort.signal.aborted) this.failed(error);
            })
            .finally(() => {
              this.probing = false;
            });
        }, interval);
        this.monitor.unref();
      }
      return ready;
    } catch (error) {
      await this.halt();
      await this.installationFonts?.stop();
      this.installationFonts = null;
      this.fontCatalog = undefined;
      throw error;
    }
  }

  private failed(error: Error): void {
    if (!this.connection || this.recovering || !this.wanted) return;
    const epoch = this.epoch;
    this.connection = null;
    const operation = (async (): Promise<ReceptionConnection> => {
      await this.halt();
      // Rust alone owns accepted state. Never resurrect a scene from a host seed
      // or a JavaScript checkpoint after receiver loss.
      this.settings.resources = Object.fromEntries(
        Object.entries(this.options.resources).map(([target, resource]) => [
          target,
          resource.type === "solar.lsml/1"
            ? null
            : structuredClone(resource.initial),
        ]),
      );
      let last = error;
      const attempts = this.options.recoveryAttempts ?? 3;
      for (
        let attempt = 1;
        attempt <= attempts && this.wanted && epoch === this.epoch;
        attempt++
      ) {
        this.options.onRecovery?.({ attempt, state: "recovering" });
        await new Promise<void>((yes) => setTimeout(yes, 250 * attempt));
        if (!this.wanted || epoch !== this.epoch) break;
        try {
          const ready = await this.launch();
          if (!this.wanted || epoch !== this.epoch) {
            await this.halt();
            break;
          }
          this.options.onRecovery?.({ attempt, state: "ready" });
          for (const reconnect of this.recoveryListeners) reconnect();
          return ready;
        } catch (next) {
          last = next instanceof Error ? next : new Error(String(next));
        }
      }
      if (this.wanted && epoch === this.epoch) this.options.onFailure?.(last);
      throw last;
    })();
    this.recovering = operation;
    void operation
      .finally(() => {
        if (this.recovering === operation) this.recovering = null;
      })
      .catch(() => {});
  }

  private async exchange<T>(
    work: (peer: BrowserLSDP, signal: AbortSignal) => Promise<T>,
  ): Promise<T> {
    const connection = this.connection,
      lifetime = this.abort;
    if (!connection || !lifetime || lifetime.signal.aborted)
      throw new Error("LSDP_NOT_READY");
    const timeout = AbortSignal.timeout(this.options.timeoutMs ?? 15_000);
    const signal = AbortSignal.any([timeout, lifetime.signal]);
    const peer = new BrowserLSDP(connection.websocketUrl);
    this.peers.add(peer);
    const close = (): void => peer.close();
    signal.addEventListener("abort", close, { once: true });
    try {
      await peer.ready;
      signal.throwIfAborted();
      return await work(peer, signal);
    } finally {
      signal.removeEventListener("abort", close);
      this.peers.delete(peer);
      peer.close();
    }
  }

  async check(): Promise<void> {
    await this.exchange(async (peer, signal) => {
      const value = (await peer.transaction(
        { kind: "capabilities" },
        { signal },
      )) as { ready?: boolean; profiles?: string[]; resources?: string[] };
      if (
        !value.ready ||
        requiredProfiles.some(
          (profile) => !value.profiles?.includes(profile),
        ) ||
        Object.keys(this.options.resources).some(
          (target) => !value.resources?.includes(target),
        )
      )
        throw new Error("LSDP_CAPABILITIES_INVALID");
    });
  }

  private resource(target: string): ReceptionResource {
    const resource = this.options.resources[target];
    if (!resource) throw new Error("LSDP_RESOURCE_UNKNOWN");
    return resource;
  }

  async read(target: string): Promise<NativeSnapshot> {
    this.resource(target);
    return this.exchange(async (peer, signal) => {
      let resolveSnapshot!: (snapshot: NativeSnapshot) => void;
      let rejectSnapshot!: (error: Error) => void;
      const snapshot = new Promise<NativeSnapshot>((yes, no) => {
        resolveSnapshot = yes;
        rejectSnapshot = no;
      });
      void snapshot.catch(() => {});
      const cancel = (): void =>
        rejectSnapshot(new Error("LSDP_SNAPSHOT_CANCELLED"));
      signal.addEventListener("abort", cancel, { once: true });
      peer.options.onTransaction = async (state, context) => {
        if (
          context.metadata.profile !== "lsdp.state.read/1" ||
          context.metadata.target !== target
        )
          throw new Error("LSDP_SNAPSHOT_INVALID");
        const stateHash = nativeTreeHash(state);
        resolveSnapshot({ state, stateHash });
        return { level: "received" };
      };
      try {
        await peer.transaction({ kind: "state.read", target }, { signal });
        return await snapshot;
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    });
  }

  async apply(
    target: string,
    operations: Operation[],
    options: { id?: string; beforeHash?: string } = {},
  ): Promise<unknown> {
    this.resource(target);
    const beforeHash =
      options.beforeHash ?? (await this.read(target)).stateHash;
    return this.exchange((peer, signal) =>
      peer.transaction(
        {
          format: "lsdp.apply/1",
          id: options.id ?? randomBytes(16).toString("hex"),
          target,
          beforeHash,
          operations,
          require: "applied",
        },
        { signal },
      ),
    );
  }

  async replace(
    target: string,
    desired: unknown,
    id = randomBytes(16).toString("hex"),
  ): Promise<unknown> {
    const resource = this.resource(target);
    if (resource.type === "solar.lsml/1" && desired !== null)
      requireLSML(desired);
    validateNativeJSON(desired);
    // The existing Rust state route reads B and computes its Merkle diff to A.
    // No root-replace shortcut and no JavaScript diff here.
    const result = (await this.exchange((peer, signal) =>
      peer.transaction(
        {
          kind: "route",
          id,
          port: target,
          type: resource.type,
          payload: desired,
        },
        { signal },
      ),
    )) as { status?: string };
    if (result.status !== "completed")
      throw new Error(`LSDP_ROUTE_INCOMPLETE: ${JSON.stringify(result)}`);
    return result;
  }

  /** Shared native subscription for Electron control consumers. */
  status(): { ready: boolean; recovering: boolean; pid: number | null } {
    return {
      ready: this.connection !== null && this.recovering === null,
      recovering: this.recovering !== null,
      pid: this.connection?.pid ?? null,
    };
  }

  async watch(
    target: string,
    onState: (state: unknown) => void,
    onError: (error: Error) => void,
  ): Promise<() => void> {
    let closed = false,
      reconnecting = false,
      dispose: (() => void) | undefined;
    let retry: ReturnType<typeof setTimeout> | undefined;
    const close = (): void => {
      closed = true;
      clearTimeout(retry);
      dispose?.();
      this.watches.delete(close);
      this.recoveryListeners.delete(reconnect);
    };
    const reconnect = (): void => {
      if (closed || reconnecting || !this.wanted) return;
      reconnecting = true;
      void (async () => {
        try {
          await this.start();
          if (closed || !this.wanted) return;
          dispose = await this.watchOnce(target, onState, failed);
          if (closed) dispose();
        } catch (next) {
          if (!closed && this.wanted) {
            const error =
              next instanceof Error ? next : new Error(String(next));
            // A stale subscription must reread the live receiver, not kill it and
            // reseed it from the watcher's older state.
            try {
              await this.check();
              retry = setTimeout(reconnect, 50);
            } catch {
              this.failed(error);
              retry = setTimeout(reconnect, 250);
            }
          }
        } finally {
          reconnecting = false;
        }
      })();
    };
    const failed = (error: Error): void => {
      if (closed || !this.wanted) return;
      if ((this.options.recoveryAttempts ?? 3) === 0) {
        onError(error);
        return;
      }
      reconnect();
    };
    this.recoveryListeners.add(reconnect);
    this.watches.add(close);
    try {
      dispose = await this.watchOnce(target, onState, failed);
      if (closed) dispose();
      return close;
    } catch (error) {
      close();
      throw error;
    }
  }

  private async watchOnce(
    target: string,
    onState: (state: unknown) => void,
    onError: (error: Error) => void,
  ): Promise<() => void> {
    this.resource(target);
    const lifetime = this.abort;
    const connection = this.connection;
    if (!lifetime || !connection) throw new Error("LSDP_NOT_READY");
    let state: NativeState | null = null;
    let hash: string | null = null;
    let active = true;
    let sequence: number | null = null;
    let snapshotResolve!: () => void;
    let snapshotReject!: (error: Error) => void;
    const snapshot = new Promise<void>((resolve, reject) => {
      snapshotResolve = resolve;
      snapshotReject = reject;
    });
    void snapshot.catch(() => {});
    const close = (): void => {
      active = false;
      snapshotReject(new Error("LSDP_WATCH_CANCELLED"));
      lifetime.signal.removeEventListener("abort", close);
      peer.close();
      this.peers.delete(peer);
    };
    const failed = (error: unknown): void => {
      if (!active) return;
      close();
      onError(error instanceof Error ? error : new Error(String(error)));
    };
    const peer = new BrowserLSDP(connection.websocketUrl, {
      onClose: failed,
      onIncomingFailed: (_context, error) => failed(error),
      onTransaction: async (value, context) => {
        if (!active || lifetime.signal.aborted)
          throw new Error("Native watch cancelled.");
        if (context.metadata.target !== target)
          throw new Error("Native watch resource mismatch.");
        if (context.metadata.profile === "lsdp.state.read/1") {
          state = NativeState.from(value);
          hash = state.stateHash;
          onState(state.value);
          snapshotResolve();
          return { level: "received" };
        }
        const event = value as {
          kind?: string;
          sequence: number;
          mutation: {
            id: string;
            target: string;
            format: string;
            beforeHash: string;
            afterHash?: string;
            operations: Operation[];
          };
          receipt: {
            transactionId: string;
            target: string;
            stateHash?: string;
          };
        };
        if (
          context.metadata.profile !== "lsdp.state.subscription/1" ||
          !hash ||
          !["change", "applied_change"].includes(event.kind ?? "") ||
          event.mutation?.beforeHash !== hash ||
          event.mutation.target !== target ||
          event.receipt?.target !== target ||
          event.receipt.transactionId !== event.mutation.id ||
          event.mutation.format !==
            (event.kind === "applied_change"
              ? "lsdp.apply/1"
              : "lsdp.tree/1") ||
          !Number.isSafeInteger(event.sequence) ||
          (sequence !== null && event.sequence <= sequence)
        )
          throw new Error("Native watch requires resynchronization.");
        const next = state!.patch(event.mutation.operations);
        hash = next.stateHash;
        if (
          event.kind === "change" &&
          (hash !== event.mutation.afterHash ||
            hash !== event.receipt.stateHash)
        )
          throw new Error("Native watch integrity mismatch.");
        sequence = event.sequence;
        state = next;
        onState(state.value);
        return event.kind === "applied_change"
          ? { level: "applied", transactionId: event.mutation.id }
          : { level: "applied", stateHash: hash };
      },
    });
    this.peers.add(peer);
    lifetime.signal.addEventListener("abort", close, { once: true });
    const signal = AbortSignal.any([
      lifetime.signal,
      AbortSignal.timeout(this.options.timeoutMs ?? 15000),
    ]);
    const abort = (): void => {
      snapshotReject(new Error("LSDP_WATCH_START_TIMEOUT"));
      close();
    };
    signal.addEventListener("abort", abort, { once: true });
    try {
      await peer.ready;
      await peer.transaction({ kind: "state.read", target }, { signal });
      await snapshot;
      await peer.transaction(
        { kind: "subscribe", target, stateHash: hash },
        { signal },
      );
      return close;
    } catch (error) {
      close();
      throw error;
    } finally {
      signal.removeEventListener("abort", abort);
    }
  }

  async stop(): Promise<void> {
    this.wanted = false;
    this.epoch++;
    this.abort?.abort();
    await this.starting?.catch(() => {});
    await this.installationFonts?.stop();
    this.installationFonts = null;
    this.fontCatalog = undefined;
    for (const close of this.watches) close();
    await this.halt();
    await this.recovering?.catch(() => {});
    await this.halt();
    this.settings.resources = Object.fromEntries(
      Object.entries(this.options.resources).map(([target, resource]) => [
        target,
        structuredClone(resource.initial),
      ]),
    );
  }

  private halt(): Promise<void> {
    if (this.stopping) return this.stopping;
    this.abort?.abort();
    this.connection = null;
    if (this.monitor) clearInterval(this.monitor);
    this.monitor = null;
    for (const peer of this.peers) peer.close();
    const child = this.child;
    this.child = null;
    const operation =
      child?.pid && child.exitCode === null && child.signalCode === null
        ? new Promise<void>((yes, no) => {
            const timer = setTimeout(() => {
              child.kill("SIGKILL");
            }, 2000);
            const deadline = setTimeout(
              () => no(new Error("LSDP_STOP_TIMEOUT")),
              5000,
            );
            child.once("exit", () => {
              clearTimeout(timer);
              clearTimeout(deadline);
              yes();
            });
            child.once("error", () => {
              clearTimeout(timer);
              clearTimeout(deadline);
              yes();
            });
            child.kill();
          })
        : Promise.resolve();
    this.stopping = operation;
    void operation
      .finally(() => {
        if (this.stopping === operation) this.stopping = null;
      })
      .catch(() => {});
    return operation;
  }
}
