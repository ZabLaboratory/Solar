import type { VisionMediaSubmitReceipt } from "./vision-contracts";

export const LIVE_MEDIA_STAGE_METRIC = "solar:live-media-stage";
const SAMPLE_INTERVAL_MS = 1000;
const MAX_SAMPLES = 64;

export interface LiveMediaStageSample {
  windowMs: number;
  rvfcCallbacks: number;
  animationFrameCallbacks: number;
  /** Null when any callback in this window lacked a continuous frame baseline. */
  presentedFrameDelta: number | null;
  presentedFrameDeltaUnavailableCallbacks: number;
  coalescedInputs: number;
  bitmapStarts: number;
  bitmapSuccesses: number;
  bitmapFailures: number;
  bitmapStaleDiscards: number;
  bitmapPreparationMsTotal: number | null;
  mediaUpdateRequests: number;
  mediaUpdateBitmaps: number;
  mediaUpdateAcknowledgements: number;
  mediaUpdateFailures: number;
  mediaUpdateAckMsTotal: number | null;
  presenterFrameSubmittedAcks: number;
  renderSubmitCallSamples: number;
  renderSubmitCallMsTotal: number | null;
  renderSubmitCallUnavailable: number;
  /** Solar's pinned browser presenter exposes no GPU fence/readback completion. */
  gpuCompletionAvailable: false;
  gpuCompletionMs: null;
}

export interface LiveMediaUpdateMetricToken {
  readonly startedAt: number;
  submissionReceiptObserved: boolean;
}

export type LiveMediaStageSampleEmitter = (
  sample: LiveMediaStageSample,
) => void;

interface MutableSample {
  rvfcCallbacks: number;
  animationFrameCallbacks: number;
  presentedFrameDelta: number;
  presentedFrameDeltaUnavailableCallbacks: number;
  coalescedInputs: number;
  bitmapStarts: number;
  bitmapSuccesses: number;
  bitmapFailures: number;
  bitmapStaleDiscards: number;
  bitmapPreparationMsTotal: number;
  bitmapPreparationSamples: number;
  mediaUpdateRequests: number;
  mediaUpdateBitmaps: number;
  mediaUpdateAcknowledgements: number;
  mediaUpdateFailures: number;
  mediaUpdateAckMsTotal: number;
  mediaUpdateAckSamples: number;
  presenterFrameSubmittedAcks: number;
  renderSubmitCallSamples: number;
  renderSubmitCallMsTotal: number;
  renderSubmitCallUnavailable: number;
}

function emptySample(): MutableSample {
  return {
    rvfcCallbacks: 0,
    animationFrameCallbacks: 0,
    presentedFrameDelta: 0,
    presentedFrameDeltaUnavailableCallbacks: 0,
    coalescedInputs: 0,
    bitmapStarts: 0,
    bitmapSuccesses: 0,
    bitmapFailures: 0,
    bitmapStaleDiscards: 0,
    bitmapPreparationMsTotal: 0,
    bitmapPreparationSamples: 0,
    mediaUpdateRequests: 0,
    mediaUpdateBitmaps: 0,
    mediaUpdateAcknowledgements: 0,
    mediaUpdateFailures: 0,
    mediaUpdateAckMsTotal: 0,
    mediaUpdateAckSamples: 0,
    presenterFrameSubmittedAcks: 0,
    renderSubmitCallSamples: 0,
    renderSubmitCallMsTotal: 0,
    renderSubmitCallUnavailable: 0,
  };
}

/** Aggregates non-identifying deltas into bounded, low-rate page diagnostics. */
export class LiveMediaStageMetrics {
  private sample = emptySample();
  private windowStartMs: number;
  private lastPublishedAt: number;
  private hasActivity = false;
  private flushTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly presentedFrames = new WeakMap<object, number>();
  private readonly submissionReceipts = new WeakSet<object>();

  constructor(
    private readonly now: () => number = () => performance.now(),
    private readonly emit: LiveMediaStageSampleEmitter = emitPerformanceSample,
  ) {
    this.windowStartMs = this.safeNow();
    this.lastPublishedAt = this.windowStartMs;
  }

  recordSourceFrame(
    source: object,
    kind: "rvfc" | "animation-frame",
    presentedFrames: number | undefined,
    coalesced: boolean,
  ): void {
    if (kind === "rvfc") this.sample.rvfcCallbacks += 1;
    else this.sample.animationFrameCallbacks += 1;
    if (coalesced) this.sample.coalescedInputs += 1;
    if (kind === "rvfc" && Number.isSafeInteger(presentedFrames) && presentedFrames! >= 0) {
      const previous = this.presentedFrames.get(source);
      if (previous !== undefined && presentedFrames! >= previous) {
        this.sample.presentedFrameDelta += presentedFrames! - previous;
      } else {
        this.sample.presentedFrameDeltaUnavailableCallbacks += 1;
      }
      this.presentedFrames.set(source, presentedFrames!);
    } else {
      this.presentedFrameDeltaUnavailable(source);
    }
    this.hasActivity = true;
    this.publishIfDue();
  }

  resetSource(source: object): void {
    this.presentedFrames.delete(source);
  }

  beginBitmapPreparation(): number {
    this.sample.bitmapStarts += 1;
    this.hasActivity = true;
    return this.safeNow();
  }

  finishBitmapPreparation(startedAt: number, succeeded: boolean): void {
    if (succeeded) this.sample.bitmapSuccesses += 1;
    else this.sample.bitmapFailures += 1;
    this.addDuration(startedAt, "bitmapPreparationMsTotal", "bitmapPreparationSamples");
    this.hasActivity = true;
    this.publishIfDue();
  }

  discardStaleBitmap(): void {
    this.sample.bitmapStaleDiscards += 1;
    this.hasActivity = true;
    this.publishIfDue();
  }

  beginMediaUpdate(bitmapCount: number): LiveMediaUpdateMetricToken {
    this.sample.mediaUpdateRequests += 1;
    this.sample.mediaUpdateBitmaps += bitmapCount;
    this.hasActivity = true;
    return { startedAt: this.safeNow(), submissionReceiptObserved: false };
  }

  recordSubmissionReceipt(
    token: LiveMediaUpdateMetricToken,
    receipt: VisionMediaSubmitReceipt,
  ): void {
    if (token.submissionReceiptObserved) return;
    token.submissionReceiptObserved = true;
    if (this.submissionReceipts.has(receipt)) return;
    this.submissionReceipts.add(receipt);
    if (receipt.frameSubmitted) this.sample.presenterFrameSubmittedAcks += 1;
    if (isDuration(receipt.renderSubmitCallMs)) {
      this.sample.renderSubmitCallSamples += 1;
      this.sample.renderSubmitCallMsTotal += receipt.renderSubmitCallMs;
    } else {
      this.sample.renderSubmitCallUnavailable += 1;
    }
    this.hasActivity = true;
  }

  finishMediaUpdate(token: LiveMediaUpdateMetricToken, succeeded: boolean): void {
    if (succeeded) this.sample.mediaUpdateAcknowledgements += 1;
    else this.sample.mediaUpdateFailures += 1;
    if (!token.submissionReceiptObserved && succeeded)
      this.sample.renderSubmitCallUnavailable += 1;
    this.addDuration(token.startedAt, "mediaUpdateAckMsTotal", "mediaUpdateAckSamples");
    this.hasActivity = true;
    this.publishIfDue();
  }

  flush(): void {
    this.publishIfDue();
    if (this.hasActivity) this.scheduleFlush();
  }

  private presentedFrameDeltaUnavailable(source: object): void {
    this.presentedFrames.delete(source);
    this.sample.presentedFrameDeltaUnavailableCallbacks += 1;
  }

  private addDuration(
    startedAt: number,
    totalKey: "bitmapPreparationMsTotal" | "mediaUpdateAckMsTotal",
    samplesKey: "bitmapPreparationSamples" | "mediaUpdateAckSamples",
  ): void {
    const elapsed = this.safeNow() - startedAt;
    if (!Number.isFinite(elapsed) || elapsed < 0) return;
    this.sample[totalKey] += elapsed;
    this.sample[samplesKey] += 1;
  }

  private safeNow(): number {
    try {
      const value = this.now();
      return Number.isFinite(value) && value >= 0 ? value : 0;
    } catch {
      return 0;
    }
  }

  private publishIfDue(): void {
    if (this.safeNow() - this.lastPublishedAt >= SAMPLE_INTERVAL_MS)
      this.publish();
  }

  private scheduleFlush(): void {
    if (!this.hasActivity || this.flushTimer !== undefined) return;
    const remaining = SAMPLE_INTERVAL_MS - (this.safeNow() - this.lastPublishedAt);
    this.flushTimer = setTimeout(() => {
      this.flushTimer = undefined;
      this.flush();
    }, Math.max(1, remaining));
  }

  private publish(): void {
    if (!this.hasActivity) return;
    const now = this.safeNow();
    if (now - this.lastPublishedAt < SAMPLE_INTERVAL_MS) return;
    if (this.flushTimer !== undefined) {
      clearTimeout(this.flushTimer);
      this.flushTimer = undefined;
    }
    const endMs = Math.max(this.windowStartMs, now);
    const sample: LiveMediaStageSample = {
      windowMs: endMs - this.windowStartMs,
      rvfcCallbacks: this.sample.rvfcCallbacks,
      animationFrameCallbacks: this.sample.animationFrameCallbacks,
      presentedFrameDelta:
        this.sample.presentedFrameDeltaUnavailableCallbacks === 0 &&
        this.sample.rvfcCallbacks > 0
          ? this.sample.presentedFrameDelta
          : null,
      presentedFrameDeltaUnavailableCallbacks:
        this.sample.presentedFrameDeltaUnavailableCallbacks,
      coalescedInputs: this.sample.coalescedInputs,
      bitmapStarts: this.sample.bitmapStarts,
      bitmapSuccesses: this.sample.bitmapSuccesses,
      bitmapFailures: this.sample.bitmapFailures,
      bitmapStaleDiscards: this.sample.bitmapStaleDiscards,
      bitmapPreparationMsTotal:
        this.sample.bitmapPreparationSamples > 0
          ? this.sample.bitmapPreparationMsTotal
          : null,
      mediaUpdateRequests: this.sample.mediaUpdateRequests,
      mediaUpdateBitmaps: this.sample.mediaUpdateBitmaps,
      mediaUpdateAcknowledgements: this.sample.mediaUpdateAcknowledgements,
      mediaUpdateFailures: this.sample.mediaUpdateFailures,
      mediaUpdateAckMsTotal:
        this.sample.mediaUpdateAckSamples > 0
          ? this.sample.mediaUpdateAckMsTotal
          : null,
      presenterFrameSubmittedAcks: this.sample.presenterFrameSubmittedAcks,
      renderSubmitCallSamples: this.sample.renderSubmitCallSamples,
      renderSubmitCallMsTotal:
        this.sample.renderSubmitCallSamples > 0
          ? this.sample.renderSubmitCallMsTotal
          : null,
      renderSubmitCallUnavailable: this.sample.renderSubmitCallUnavailable,
      gpuCompletionAvailable: false,
      gpuCompletionMs: null,
    };
    try {
      this.emit(sample);
    } catch {
      // Diagnostics must not affect capture, bitmap ownership or presentation.
    }
    this.sample = emptySample();
    this.windowStartMs = endMs;
    this.lastPublishedAt = endMs;
    this.hasActivity = false;
  }
}

function isDuration(value: number | null): value is number {
  return value !== null && Number.isFinite(value) && value >= 0;
}

function emitPerformanceSample(
  sample: LiveMediaStageSample,
): void {
  try {
    if (performance.getEntriesByName(LIVE_MEDIA_STAGE_METRIC).length >= MAX_SAMPLES)
      performance.clearMeasures(LIVE_MEDIA_STAGE_METRIC);
    performance.measure(LIVE_MEDIA_STAGE_METRIC, {
      start: performance.now(),
      detail: sample,
    });
  } catch {
    // Unsupported or disabled diagnostics must not interrupt live capture.
  }
}
