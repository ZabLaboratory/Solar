import type { NativeCompositionPlan } from "./native-composition";

export interface NativeCompositionState {
  schema: "solar.native-composition.state/1";
  producers: Partial<Record<"A" | "B", string>>;
  graphs: Partial<Record<"A" | "B", NativeCompositionPlan>>;
}

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

/** The seed, full replacement and publisher snapshot share one state contract. */
export function requireNativeCompositionState(
  value: unknown,
): NativeCompositionState {
  const state = record(value);
  const producers = record(state?.producers);
  const graphs = record(state?.graphs);
  if (
    !state ||
    state.schema !== "solar.native-composition.state/1" ||
    !producers ||
    !graphs ||
    Object.keys(state).some(
      (key) => !["schema", "producers", "graphs"].includes(key),
    ) ||
    Object.keys(producers).some((key) => key !== "A" && key !== "B") ||
    Object.keys(graphs).some((key) => key !== "A" && key !== "B") ||
    Object.values(producers).some(
      (producer) =>
        typeof producer !== "string" ||
        !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/.test(producer),
    )
  )
    throw new Error("NATIVE_COMPOSITION_STATE_INVALID");
  for (const graph of Object.values(graphs)) {
    if (graph === undefined) continue;
    const plan = record(graph);
    if (
      !plan ||
      (plan.schema !== "solar.native-composition.plan/1" &&
        plan.schema !== "solar.native-composition.plan/2") ||
      (plan.schema === "solar.native-composition.plan/2" &&
        !Array.isArray(plan.coverageSurfaces)) ||
      typeof plan.producer_id !== "string" ||
      typeof plan.planHash !== "string"
    )
      throw new Error("NATIVE_COMPOSITION_GRAPH_INVALID");
  }
  for (const [graphId, graph] of Object.entries(graphs)) {
    const plan = graph as Record<string, unknown>;
    if (producers[graphId] !== plan.producer_id)
      throw new Error("NATIVE_COMPOSITION_GRAPH_OWNER_MISMATCH");
  }
  return state as unknown as NativeCompositionState;
}
