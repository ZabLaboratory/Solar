import assert from "node:assert/strict";
import test from "node:test";
import {
  correlateTransactions,
  matchesFinalPixelText,
  summarizePerformance,
  summarizePresentations,
  summarizeProducer,
  summarizeReceiveToPresentation,
} from "../../scripts/proof/native-burst-analysis.mjs";

test("transaction correlation reports gaps, duplicate ids, unknown ids and hash drift", () => {
  const expected = [
    { id: "a", stateHash: "hash-a" },
    { id: "b", stateHash: "hash-b" },
    { id: "c", stateHash: "hash-c" },
  ];
  const result = correlateTransactions(expected, [
    { detail: { transactionId: "a", stateHash: "hash-a" } },
    { detail: { transactionId: "b", stateHash: "wrong-b" } },
    { detail: { transactionId: "a", stateHash: "hash-a" } },
    { detail: { transactionId: "other", stateHash: "hash-x" } },
  ]);

  assert.deepEqual(result.missingIds, ["c"]);
  assert.deepEqual(result.duplicateObservedIds, ["a"]);
  assert.equal(result.unexpectedEvents[0].transactionId, "other");
  assert.deepEqual(result.hashMismatches, [
    { id: "b", expectedHash: "hash-b", observedHash: "wrong-b" },
  ]);
  assert.equal(result.complete, false);
});

test("presentation summary counts unique covering frames and coalesced mutations", () => {
  const result = summarizePresentations([
    { detail: { presentation: { throughSequence: 9, mutationCount: 2 } } },
    { detail: { presentation: { throughSequence: 9, mutationCount: 2 } } },
    { detail: { presentation: { throughSequence: 10, mutationCount: 1 } } },
  ]);

  assert.equal(result.submittedFrameCount, 2);
  assert.equal(result.representedMutationCount, 3);
  assert.equal(result.coalescedMutationCount, 1);
  assert.deepEqual(result.batchEventCountMismatches, []);
});

test("missing presentation data stays unavailable rather than becoming zero", () => {
  const result = summarizePresentations([{ detail: {} }]);
  assert.equal(result.submittedFrameCount, 0);
  assert.equal(result.representedMutationCount, null);
  assert.equal(result.coalescedMutationCount, null);
  assert.equal(result.unavailableEvents, 1);
});

test("performance summary uses observed queue telemetry and preserves unknown stages", () => {
  const result = summarizePerformance([
    { name: "solar:native-stage", duration: 2, detail: { stage: "worker-main-queue", queueHighWater: 3 } },
    { name: "solar:native-stage", duration: 4, detail: { stage: "worker-main-queue", queueHighWater: 5 } },
    { name: "solar:native-stage", duration: 1, detail: { stage: "frame-patches-queue", queueHighWater: 7, pendingAtFlush: 4, oldestAgeMs: 8.5 } },
    { name: "solar:native-stage", duration: 0, detail: { stage: "other" } },
  ]);

  assert.equal(result.workerMainQueueHighWater, 5);
  assert.equal(result.framePatchQueueHighWater, 7);
  assert.equal(result.framePatchPendingAtFlushHighWater, 4);
  assert.equal(result.framePatchOldestAgeMsHighWater, 8.5);
  assert.equal(result.stageDurations.other.count, 1);
});

test("producer throughput uses measured send and ACK timestamps", () => {
  const result = summarizeProducer({
    operationCount: 2,
    nativeDrainMs: 900,
    receipts: [
      { id: "a", sentEpochMs: 1000, epochMs: 1100, stateHash: "h1", ackStateHash: null },
      { id: "b", sentEpochMs: 1500, epochMs: 1600, stateHash: "h2", ackStateHash: null },
    ],
  });

  assert.equal(result.elapsedToLastAckMs, 600);
  assert.equal(result.sentToAckRatePerSecond, 1000 / 300);
  assert.equal(result.nativeDrainMs, 900);
  assert.equal(result.ackStateHashUnavailableCount, 2);
});

test("receive-to-presentation latency correlates timestamps and reports nearest-rank quantiles", () => {
  const result = summarizeReceiveToPresentation(
    [
      { captureEpochMs: 100, detail: { transactionId: "a" } },
      { captureEpochMs: 200, detail: { transactionId: "b" } },
      { captureEpochMs: 300, detail: { transactionId: "c" } },
      { captureEpochMs: 400, detail: { transactionId: "missing" } },
    ],
    [
      { captureEpochMs: 101, detail: { transactionId: "a", presentation: { throughSequence: 1 } } },
      { captureEpochMs: 203, detail: { transactionId: "b", presentation: { throughSequence: 2 } } },
      { captureEpochMs: 310, detail: { transactionId: "c", presentation: { throughSequence: 3 } } },
      { captureEpochMs: 499, detail: { transactionId: "unmatched", presentation: { throughSequence: 4 } } },
    ],
  );

  assert.equal(result.matchedPresentationPairCount, 3);
  assert.equal(result.receivedWithoutAppliedCount, 1);
  assert.equal(result.appliedWithoutReceivedCount, 1);
  assert.deepEqual(result.latency, {
    count: 3,
    p50Ms: 3,
    p95Ms: 10,
    maxMs: 10,
  });
  assert.equal(result.separateApplyToSubmissionLatency, null);
});

test("unavailable, negative and missing presentation timestamps stay unknown", () => {
  const result = summarizeReceiveToPresentation(
    [
      { captureEpochMs: 10, detail: { transactionId: "no-presentation" } },
      { detail: { transactionId: "missing-time" } },
      { captureEpochMs: 20, detail: { transactionId: "negative" } },
    ],
    [
      { captureEpochMs: 11, detail: { transactionId: "no-presentation" } },
      { captureEpochMs: 15, detail: { transactionId: "missing-time", presentation: { throughSequence: 2 } } },
      { captureEpochMs: 19, detail: { transactionId: "negative", presentation: { throughSequence: 3 } } },
    ],
  );

  assert.equal(result.matchedPresentationPairCount, 0);
  assert.equal(result.matchedWithoutPresentation, 1);
  assert.equal(result.unavailableTimestampPairs, 2);
  assert.deepEqual(result.latency, {
    count: 0,
    p50Ms: null,
    p95Ms: null,
    maxMs: null,
  });
});

test("pixel text must match the complete final counter", () => {
  assert.equal(matchesFinalPixelText("0512/0512\n", "0512/0512"), true);
  assert.equal(matchesFinalPixelText("0511/0512", "0512/0512"), false);
  assert.equal(matchesFinalPixelText(null, "0512/0512"), false);
});
