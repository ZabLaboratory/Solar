import { finite } from "./curves";

type VectorPath = { commands: string[]; coordinates: number[][] };
const arity: Record<string, number> = { M: 2, L: 2, C: 6, Q: 4, Z: 0 };
/** Explicit absolute commands keep correspondence authored, never guessed. */
export function parseMorphPath(raw: unknown): VectorPath {
  if (typeof raw !== "string" || raw.length > 32768)
    throw new Error("Morph path must be a bounded SVG string");
  const tokens =
    raw.match(/[MLCQZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?/g) ?? [];
  if (
    raw.replace(
      /[MLCQZ]|[-+]?(?:\d*\.\d+|\d+\.?\d*)(?:[eE][-+]?\d+)?|[\s,]/g,
      "",
    )
  )
    throw new Error("Morph paths require explicit absolute M/L/C/Q/Z commands");
  const commands: string[] = [],
    coordinates: number[][] = [];
  let index = 0,
    count = 0,
    open = false;
  while (index < tokens.length) {
    const command = tokens[index++]!;
    if (!Object.hasOwn(arity, command) || (command !== "M" && !open))
      throw new Error("Invalid morph path command order");
    const values: number[] = [];
    for (let i = 0; i < arity[command]!; i++) {
      const token = tokens[index++];
      if (!token || Object.hasOwn(arity, token))
        throw new Error("Incomplete morph path command");
      values.push(finite(Number(token), "path coordinate", -1e6, 1e6));
    }
    open = command !== "Z";
    commands.push(command);
    coordinates.push(values);
    count += values.length;
    if (commands.length > 1024 || count > 4096)
      throw new Error("Morph path coordinate budget exceeded");
  }
  if (!commands.length || commands[0] !== "M")
    throw new Error("Empty morph path");
  return { commands, coordinates };
}

/** Compile numeric interpolation once; endpoints retain the exact authored string. */
export function morphPath(from: string, to: string): (phase: number) => string {
  const a = parseMorphPath(from),
    b = parseMorphPath(to);
  if (a.commands.join("") !== b.commands.join(""))
    throw new Error(
      "Morph paths require matching commands and subpath topology",
    );
  return (phase) => {
    if (phase === 0) return from;
    if (phase === 1) return to;
    return a.commands
      .map(
        (command, i) =>
          command +
          a.coordinates[i]!.map((value, j) =>
            Number(
              (value + (b.coordinates[i]![j]! - value) * phase).toFixed(4),
            ),
          ).join(" "),
      )
      .join(" ");
  };
}
