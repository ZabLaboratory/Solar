function numeric(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function maximum(values) {
  const known = values.filter((value) => value !== null);
  return known.length ? Math.max(...known) : null;
}

function summarizeDurations(values) {
  const durations = values
    .map(numeric)
    .filter((value) => value !== null)
    .sort((left, right) => left - right);
  if (!durations.length)
    return { count: 0, p50Ms: null, p95Ms: null, maxMs: null };
  const nearestRank = (percentile) =>
    durations[Math.max(0, Math.ceil(durations.length * percentile) - 1)];
  return {
    count: durations.length,
    p50Ms: nearestRank(0.5),
    p95Ms: nearestRank(0.95),
    maxMs: durations.at(-1),
  };
}

export function summarizeReceiveToPresentation(receivedEvents, appliedEvents) {
  const receivedById = new Map();
  const appliedById = new Map();
  let duplicateReceivedIds = 0;
  let duplicateAppliedIds = 0;
  for (const event of receivedEvents) {
    const id = event?.detail?.transactionId;
    if (typeof id !== "string") continue;
    if (receivedById.has(id)) duplicateReceivedIds++;
    else receivedById.set(id, event);
  }
  for (const event of appliedEvents) {
    const id = event?.detail?.transactionId;
    if (typeof id !== "string") continue;
    if (appliedById.has(id)) duplicateAppliedIds++;
    else appliedById.set(id, event);
  }

  const latencyMs = [];
  let matchedWithoutPresentation = 0;
  let unavailableTimestampPairs = 0;
  for (const [id, applied] of appliedById) {
    const received = receivedById.get(id);
    if (!received) continue;
    const submittedSequence = numeric(applied?.detail?.presentation?.throughSequence);
    if (submittedSequence === null) {
      matchedWithoutPresentation++;
      continue;
    }
    const receivedAt = numeric(received.captureEpochMs);
    const submittedAt = numeric(applied.captureEpochMs);
    if (receivedAt === null || submittedAt === null || submittedAt < receivedAt) {
      unavailableTimestampPairs++;
      continue;
    }
    latencyMs.push(submittedAt - receivedAt);
  }

  return {
    boundary:
      "solar:lsdp-received event capture to solar:lsdp-applied event capture, which follows Vision frame-submitted and retained-front-canvas copy",
    matchedPresentationPairCount: latencyMs.length,
    receivedWithoutAppliedCount: [...receivedById.keys()].filter((id) => !appliedById.has(id)).length,
    appliedWithoutReceivedCount: [...appliedById.keys()].filter((id) => !receivedById.has(id)).length,
    matchedWithoutPresentation,
    unavailableTimestampPairs,
    duplicateReceivedIds,
    duplicateAppliedIds,
    latency: summarizeDurations(latencyMs),
    separateApplyToSubmissionLatency: null,
    separateLatencyUnavailableReason:
      "Solar exposes the applied event after the covering Vision submission and front-canvas copy; it does not expose a separate timestamp before submission.",
  };
}

export function summarizePostAckDrain(producer, appliedEvents, pixels) {
  const lastAckEpochMs = numeric(producer?.lastNativeAckEpochMs);
  const presentationEvents = appliedEvents.filter(
    (event) => numeric(event?.detail?.presentation?.throughSequence) !== null,
  );
  const lastPresentationEpochMs = presentationEvents.length
    ? maximum(presentationEvents.map((event) => numeric(event.captureEpochMs)))
    : null;
  const finalPixelsEpochMs = numeric(pixels?.captureEpochMs);
  const afterAck = (endEpochMs) =>
    lastAckEpochMs !== null && endEpochMs !== null && endEpochMs >= lastAckEpochMs
      ? endEpochMs - lastAckEpochMs
      : null;
  return {
    lastNativeAckEpochMs: lastAckEpochMs,
    lastCoveringSubmissionEpochMs: lastPresentationEpochMs,
    finalRetainedCanvasOcrEpochMs: finalPixelsEpochMs,
    lastAckToLastCoveringSubmissionMs: afterAck(lastPresentationEpochMs),
    lastAckToFinalRetainedCanvasOcrMs: afterAck(finalPixelsEpochMs),
    physicalFrameDrain: null,
    physicalFrameDrainUnavailableReason:
      "The browser exposes retained-canvas capture and Vision frame-submitted completion, not physical display frames or scanout.",
  };
}

export function correlateTransactions(expectedReceipts, observedEvents) {
  const expectedById = new Map();
  const duplicateExpectedIds = [];
  for (const receipt of expectedReceipts) {
    if (expectedById.has(receipt.id)) duplicateExpectedIds.push(receipt.id);
    else expectedById.set(receipt.id, receipt);
  }

  const observedIds = new Map();
  const unexpectedEvents = [];
  const duplicateObservedIds = [];
  const hashMismatches = [];
  const hashUnavailableIds = [];
  let matched = 0;
  for (const record of observedEvents) {
    const detail = record?.detail ?? {};
    const id = detail.transactionId;
    if (typeof id !== "string" || !expectedById.has(id)) {
      unexpectedEvents.push({
        transactionId: typeof id === "string" ? id : null,
        stateHash: typeof detail.stateHash === "string" ? detail.stateHash : null,
      });
      continue;
    }
    matched++;
    observedIds.set(id, (observedIds.get(id) ?? 0) + 1);
    if (observedIds.get(id) > 1) duplicateObservedIds.push(id);
    const expectedHash = expectedById.get(id)?.stateHash;
    const observedHash = detail.stateHash;
    if (typeof observedHash !== "string") hashUnavailableIds.push(id);
    else if (typeof expectedHash === "string" && observedHash !== expectedHash)
      hashMismatches.push({ id, expectedHash, observedHash });
  }

  const missingIds = [...expectedById.keys()].filter(
    (id) => !observedIds.has(id),
  );
  return {
    expectedCount: expectedReceipts.length,
    expectedUniqueCount: expectedById.size,
    duplicateExpectedIds,
    observedEventCount: observedEvents.length,
    matchedEventCount: matched,
    uniqueObservedCount: observedIds.size,
    missingIds,
    duplicateObservedIds,
    unexpectedEvents,
    hashMismatches,
    hashUnavailableIds,
    complete: expectedById.size === expectedReceipts.length &&
      missingIds.length === 0 &&
      duplicateObservedIds.length === 0 &&
      unexpectedEvents.length === 0 &&
      hashMismatches.length === 0 &&
      hashUnavailableIds.length === 0,
  };
}

export function summarizePresentations(appliedEvents) {
  const groups = new Map();
  let unavailableEvents = 0;
  const inconsistencies = [];
  for (const record of appliedEvents) {
    const presentation = record?.detail?.presentation;
    const sequence = numeric(presentation?.throughSequence);
    const mutationCount = numeric(presentation?.mutationCount);
    if (sequence === null || mutationCount === null || mutationCount < 1) {
      unavailableEvents++;
      continue;
    }
    const previous = groups.get(sequence);
    if (previous && previous.mutationCount !== mutationCount)
      inconsistencies.push({
        throughSequence: sequence,
        firstMutationCount: previous.mutationCount,
        nextMutationCount: mutationCount,
      });
    if (!previous) groups.set(sequence, { mutationCount, eventCount: 0 });
    groups.get(sequence).eventCount++;
  }

  const batches = [...groups.entries()]
    .sort(([left], [right]) => left - right)
    .map(([throughSequence, value]) => ({
      throughSequence,
      ...value,
      eventCountMatchesMutationCount: value.eventCount === value.mutationCount,
    }));
  return {
    appliedEventCount: appliedEvents.length,
    submittedFrameCount:
      groups.size > 0 ? groups.size : appliedEvents.length > 0 ? 0 : null,
    unavailableEvents,
    batches,
    representedMutationCount: batches.length
      ? batches.reduce((total, batch) => total + batch.mutationCount, 0)
      : null,
    coalescedMutationCount: batches.length
      ? batches.reduce((total, batch) => total + batch.mutationCount - 1, 0)
      : null,
    inconsistentMutationCounts: inconsistencies,
    batchEventCountMismatches: batches
      .filter((batch) => !batch.eventCountMatchesMutationCount)
      .map(({ throughSequence, eventCount, mutationCount }) => ({
        throughSequence,
        eventCount,
        mutationCount,
      })),
  };
}

export function summarizePerformance(entries) {
  const stages = new Map();
  for (const entry of entries) {
    const stage = entry?.detail?.stage;
    if (typeof stage !== "string") continue;
    const values = stages.get(stage) ?? [];
    values.push(entry);
    stages.set(stage, values);
  }
  const worker = stages.get("worker-main-queue") ?? [];
  const framePatches = stages.get("frame-patches-queue") ?? [];
  const stageDurations = Object.fromEntries(
    [...stages.entries()].map(([stage, items]) => [
      stage,
      summarizeDurations(items.map((item) => item.duration)),
    ]),
  );
  return {
    entryCount: entries.length,
    stageCount: stages.size,
    stageDurations,
    workerMainQueueHighWater: maximum(
      worker.map((entry) => numeric(entry?.detail?.queueHighWater)),
    ),
    framePatchQueueHighWater: maximum(
      framePatches.map((entry) => numeric(entry?.detail?.queueHighWater)),
    ),
    framePatchPendingAtFlushHighWater: maximum(
      framePatches.map((entry) => numeric(entry?.detail?.pendingAtFlush)),
    ),
    framePatchOldestAgeMsHighWater: maximum(
      framePatches.map((entry) => numeric(entry?.detail?.oldestAgeMs)),
    ),
    unavailableQueueSamples:
      worker.filter((entry) => numeric(entry?.detail?.queueHighWater) === null).length +
      framePatches.filter((entry) =>
        numeric(entry?.detail?.queueHighWater) === null ||
        numeric(entry?.detail?.pendingAtFlush) === null ||
        numeric(entry?.detail?.oldestAgeMs) === null,
      ).length,
  };
}

export function summarizeProducer(producer) {
  const receipts = Array.isArray(producer?.receipts) ? producer.receipts : [];
  const ids = receipts.map((receipt) => receipt?.id).filter((id) => typeof id === "string");
  const uniqueIds = new Set(ids);
  const firstSentEpochMs = numeric(receipts[0]?.sentEpochMs);
  const lastSentEpochMs = numeric(receipts.at(-1)?.sentEpochMs);
  const firstAckEpochMs = numeric(receipts[0]?.epochMs);
  const lastAckEpochMs = numeric(receipts.at(-1)?.epochMs);
  const elapsedToLastAckMs =
    firstSentEpochMs !== null && lastAckEpochMs !== null
      ? lastAckEpochMs - firstSentEpochMs
      : null;
  const sendWindowMs =
    firstSentEpochMs !== null && lastSentEpochMs !== null
      ? lastSentEpochMs - firstSentEpochMs
      : null;
  const rate = (elapsedMs) =>
    elapsedMs !== null && elapsedMs > 0 ? (receipts.length * 1000) / elapsedMs : null;
  const hashChecks = receipts.filter(
    (receipt) => typeof receipt?.ackStateHash === "string",
  );
  const ackHashMismatches = hashChecks
    .filter((receipt) => receipt.ackStateHash !== receipt.stateHash)
    .map((receipt) => ({
      id: receipt.id,
      expectedHash: receipt.stateHash,
      ackStateHash: receipt.ackStateHash,
    }));
  return {
    operationCount: numeric(producer?.operationCount),
    receiptCount: receipts.length,
    uniqueReceiptCount: uniqueIds.size,
    duplicateReceiptIds: ids.filter((id, index) => ids.indexOf(id) !== index),
    firstSentEpochMs,
    lastSentEpochMs,
    firstAckEpochMs,
    lastAckEpochMs,
    sendWindowMs,
    elapsedToLastAckMs,
    inputRatePerSecond: rate(sendWindowMs),
    sentToAckRatePerSecond: rate(elapsedToLastAckMs),
    nativeDrainMs: numeric(producer?.nativeDrainMs),
    ackStateHashCount: hashChecks.length,
    ackStateHashUnavailableCount: receipts.length - hashChecks.length,
    ackHashMismatches,
  };
}

export function matchesFinalPixelText(ocrText, expectedValue) {
  if (typeof ocrText !== "string" || typeof expectedValue !== "string") return false;
  return ocrText.replace(/[^0-9/]/g, "") === expectedValue;
}
