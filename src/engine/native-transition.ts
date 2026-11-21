/** Orion supplies the logical role: physical A/B never implies Preview/Program. */
export function nativeTransition(state: unknown, resource: string) {
  const logicalLane =
    resource === "solar/program"
      ? "program"
      : resource === "solar/preview"
        ? "preview"
        : null;
  const physical = resource === "solar/lane-a" || resource === "solar/lane-b";
  if (
    (!logicalLane && !physical) ||
    (state !== null && typeof state !== "object")
  )
    return null;
  const transition = (state as Record<string, unknown> | null)?.[
    "x-solar-transition"
  ] as
    | {
        request_id: string;
        phase: string;
        lane?: "program" | "preview";
        source?: unknown;
      }
    | undefined;
  const lane = logicalLane ?? transition?.lane;
  if (
    transition &&
    ((lane !== "program" && lane !== "preview") ||
      !/^[a-zA-Z0-9_:-]{1,128}$/.test(transition.request_id) ||
      !["prepare", "commit", "finalize", "abort"].includes(transition.phase))
  )
    throw new Error("SOLAR_TRANSITION_INVALID");
  return { transition, lane };
}
