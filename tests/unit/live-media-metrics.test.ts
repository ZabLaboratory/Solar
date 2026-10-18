import { afterEach, describe, expect, it, vi } from "vitest";
import {
  LiveMediaStageMetrics,
  type LiveMediaStageSample,
} from "../../src/engine/live-media-metrics";

describe("bounded live-media stage metrics", () => {
  afterEach(() => vi.useRealTimers());

  it("reports source deltas, unknown baselines, bitmap failures and observed submission acknowledgements", () => {
    let now = 10;
    const samples: LiveMediaStageSample[] = [];
    const metrics = new LiveMediaStageMetrics(() => now, (sample) => samples.push(sample));
    const source = {};

    metrics.recordSourceFrame(source, "rvfc", undefined, false);
    metrics.recordSourceFrame(source, "rvfc", 20, true);
    metrics.recordSourceFrame(source, "rvfc", 23, true);

    const bitmap = metrics.beginBitmapPreparation();
    now += 4;
    metrics.finishBitmapPreparation(bitmap, true);
    metrics.discardStaleBitmap();
    const failedBitmap = metrics.beginBitmapPreparation();
    now += 3;
    metrics.finishBitmapPreparation(failedBitmap, false);

    const receipt = { frameSubmitted: true, renderSubmitCallMs: 2.5 } as const;
    const submitted = metrics.beginMediaUpdate(2);
    now += 5;
    metrics.recordSubmissionReceipt(submitted, receipt);
    metrics.finishMediaUpdate(submitted, true);

    const coalescedUpdate = metrics.beginMediaUpdate(1);
    metrics.recordSubmissionReceipt(coalescedUpdate, receipt);
    metrics.finishMediaUpdate(coalescedUpdate, true);

    const failedUpdate = metrics.beginMediaUpdate(1);
    now += 2;
    metrics.finishMediaUpdate(failedUpdate, false);
    now = 1010;
    metrics.flush();

    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      windowMs: 1000,
      rvfcCallbacks: 3,
      presentedFrameDelta: null,
      presentedFrameDeltaUnavailableCallbacks: 2,
      coalescedInputs: 2,
      bitmapStarts: 2,
      bitmapSuccesses: 1,
      bitmapFailures: 1,
      bitmapStaleDiscards: 1,
      bitmapPreparationMsTotal: 7,
      mediaUpdateRequests: 3,
      mediaUpdateBitmaps: 4,
      mediaUpdateAcknowledgements: 2,
      mediaUpdateFailures: 1,
      mediaUpdateAckMsTotal: 7,
      presenterFrameSubmittedAcks: 1,
      renderSubmitCallSamples: 1,
      renderSubmitCallMsTotal: 2.5,
      renderSubmitCallUnavailable: 0,
      gpuCompletionAvailable: false,
      gpuCompletionMs: null,
    });
  });

  it("starts a fresh presented-frame baseline after a reset and bounds publication to one sample per second", () => {
    let now = 0;
    const samples: LiveMediaStageSample[] = [];
    const metrics = new LiveMediaStageMetrics(() => now, (sample) => samples.push(sample));
    const source = {};

    metrics.recordSourceFrame(source, "rvfc", 100, false);
    now = 1000;
    metrics.recordSourceFrame(source, "rvfc", 104, false);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      presentedFrameDelta: null,
      presentedFrameDeltaUnavailableCallbacks: 1,
    });

    metrics.resetSource(source);
    now = 2000;
    metrics.recordSourceFrame(source, "rvfc", 200, false);
    expect(samples).toHaveLength(2);
    expect(samples[1]).toMatchObject({
      presentedFrameDelta: null,
      presentedFrameDeltaUnavailableCallbacks: 1,
    });

    now = 3000;
    metrics.recordSourceFrame(source, "rvfc", 204, false);
    expect(samples[2]).toMatchObject({
      presentedFrameDelta: 4,
      presentedFrameDeltaUnavailableCallbacks: 0,
    });

    expect(samples).toHaveLength(3);
    metrics.recordSourceFrame(source, "animation-frame", undefined, false);
    now = 4000;
    metrics.recordSourceFrame(source, "animation-frame", undefined, true);
    expect(samples).toHaveLength(4);
    expect(samples[3]).toMatchObject({
      animationFrameCallbacks: 2,
      presentedFrameDelta: null,
      presentedFrameDeltaUnavailableCallbacks: 2,
      coalescedInputs: 1,
    });
  });

  it("defers disposal flush until the one-second publication interval permits it", async () => {
    vi.useFakeTimers();
    let now = 0;
    const samples: LiveMediaStageSample[] = [];
    const metrics = new LiveMediaStageMetrics(() => now, (sample) => samples.push(sample));
    const source = {};

    metrics.recordSourceFrame(source, "rvfc", 1, false);
    now = 1000;
    metrics.recordSourceFrame(source, "rvfc", 2, false);
    expect(samples).toHaveLength(1);
    now = 1500;
    metrics.recordSourceFrame(source, "rvfc", 3, false);
    metrics.flush();
    expect(samples).toHaveLength(1);

    now = 2000;
    await vi.advanceTimersByTimeAsync(500);
    expect(samples).toHaveLength(2);
    expect(samples[1]).toMatchObject({
      windowMs: 1000,
      presentedFrameDelta: 1,
    });
  });

  it("does not publish partial samples more often than once per second", () => {
    let now = 0;
    const samples: LiveMediaStageSample[] = [];
    const metrics = new LiveMediaStageMetrics(() => now, (sample) => samples.push(sample));
    const source = {};

    metrics.recordSourceFrame(source, "rvfc", 1, false);
    now = 999;
    metrics.recordSourceFrame(source, "rvfc", 2, false);
    expect(samples).toHaveLength(0);
    now = 1000;
    metrics.recordSourceFrame(source, "rvfc", 3, false);
    expect(samples).toHaveLength(1);
    expect(samples[0]).toMatchObject({
      windowMs: 1000,
      presentedFrameDelta: null,
      presentedFrameDeltaUnavailableCallbacks: 1,
    });
    now = 1999;
    metrics.recordSourceFrame(source, "rvfc", 4, false);
    expect(samples).toHaveLength(1);
    now = 2000;
    metrics.recordSourceFrame(source, "rvfc", 5, false);
    expect(samples).toHaveLength(2);
    expect(samples[1]).toMatchObject({
      windowMs: 1000,
      presentedFrameDelta: 2,
      presentedFrameDeltaUnavailableCallbacks: 0,
    });
  });

  it("does not let a failing diagnostic sink affect the metrics caller", () => {
    let now = 0;
    const metrics = new LiveMediaStageMetrics(() => now, () => {
      throw new Error("diagnostics disabled");
    });
    const source = {};
    metrics.recordSourceFrame(source, "rvfc", 1, false);
    now = 1000;
    expect(() => metrics.recordSourceFrame(source, "rvfc", 2, false)).not.toThrow();
  });

  it("caps the visible Performance entry history", () => {
    const name = "solar:live-media-stage";
    performance.clearMeasures(name);
    let now = 0;
    const metrics = new LiveMediaStageMetrics(() => now);
    for (let index = 0; index < 71; index += 1) {
      metrics.recordSourceFrame({}, "rvfc", index, false);
      now += 1000;
    }
    expect(performance.getEntriesByName(name)).toHaveLength(6);
    performance.clearMeasures(name);
  });
});
