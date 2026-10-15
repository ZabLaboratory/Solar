import type { SolarToken } from "../types";

export type NativeLsdpReconnectTarget = "primary" | "composition";

interface ReconnectActions {
  active: () => boolean;
  connectPrimary: () => void;
  reconnectComposition: () => void;
  connecting: () => void;
}

/** One backoff timer arbitrates recovery of the primary and derived peers. */
export class NativeLsdpReconnect {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private target: NativeLsdpReconnectTarget | null = null;
  private delay = 250;
  private compositionAttempt: AbortController | null = null;

  constructor(private readonly actions: ReconnectActions) {}

  schedule(target: NativeLsdpReconnectTarget): void {
    if (!this.actions.active()) return;
    if (target === "primary") this.compositionAttempt?.abort();
    if (this.timer !== null) {
      if (this.target === "primary" || target === "composition") return;
      clearTimeout(this.timer);
    }
    if (target === "primary") this.actions.connecting();
    this.target = target;
    this.timer = setTimeout(() => {
      const next = this.target;
      this.timer = null;
      this.target = null;
      if (!this.actions.active()) return;
      if (next === "composition") this.actions.reconnectComposition();
      else this.actions.connectPrimary();
    }, this.delay);
    this.delay = Math.min(this.delay * 2, 10_000);
  }

  reset(): void {
    this.delay = 250;
  }

  async recoverComposition(
    token: SolarToken,
    start: (authToken: string) => void,
    report: (error: unknown) => void,
  ): Promise<void> {
    if (!this.actions.active()) return;
    this.compositionAttempt?.abort();
    const attempt = new AbortController();
    this.compositionAttempt = attempt;
    try {
      const authToken = typeof token === "string" ? token : await token.fetch();
      if (!this.actions.active() || attempt.signal.aborted) return;
      start(authToken);
    } catch (error) {
      if (!this.actions.active() || attempt.signal.aborted) return;
      report(error);
      this.schedule("composition");
    } finally {
      if (this.compositionAttempt === attempt) this.compositionAttempt = null;
    }
  }

  clear(): void {
    this.compositionAttempt?.abort();
    this.compositionAttempt = null;
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.target = null;
  }
}
