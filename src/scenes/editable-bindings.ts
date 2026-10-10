import type { LSMLDocument } from "./native-document";

/** Pulsar owns local capture pixels; Vision supplies transparent z-order bands. */
export function prepareNativeComposition(
  document: LSMLDocument,
  viewport: { width: number; height: number },
): void {
  const root = document.layout as Record<string, unknown>;
  const children = Array.isArray(root.children) ? root.children : [];
  const bands: unknown[][] = [[]];
  const replaceCaptures = (value: unknown): void => {
    if (!value || typeof value !== "object") return;
    if (Array.isArray(value)) {
      value.forEach(replaceCaptures);
      return;
    }
    const node = value as Record<string, unknown>;
    if (node.kind === "x-zab.capture") {
      node.kind = "frame";
      node.size ??= { w: 0, h: 0 };
      delete node["x-zab.deviceRef"];
      delete node["x-zab.sourceKind"];
    }
    if (Array.isArray(node.children)) node.children.forEach(replaceCaptures);
  };
  let mixed = false;
  for (const child of children) {
    const capture =
      (child as Record<string, unknown>)?.kind === "x-zab.capture";
    const node = child as Record<string, unknown>;
    if (
      !capture &&
      mixed &&
      typeof node.blendMode === "string" &&
      node.blendMode !== "normal"
    ) {
      // Pulsar owns the complete backdrop (native pixels plus earlier bands).
      // Vision supplies the isolated source contribution without blending twice.
      bands.push([{ ...node, blendMode: "normal" }], []);
    } else if (!capture) bands.at(-1)!.push(child);
    else {
      mixed = true;
      bands.push([]);
    }
  }
  replaceCaptures(root);
  // Pulsar still owns the full browser atlas, but trailing capture-only bands
  // have no Vision pixels. Keep inner gaps for z-order; omit empty tail surfaces
  // so the GPU/front-canvas copy does not grow with capture-only overlays.
  while (bands.length > 1 && bands.at(-1)!.length === 0) bands.pop();
  if (bands.length === 1) {
    root.children = bands[0];
    return;
  }
  document.layout = {
    kind: "frame",
    size: { w: viewport.width, h: viewport.height * bands.length },
    children: bands.map((children, index) => {
      const layer: Record<string, unknown> = { ...root, children };
      delete layer.id;
      if (index > 0) {
        for (const key of [
          "fill",
          "fills",
          "background",
          "stroke",
          "strokes",
          "shadow",
          "blur",
          "glass",
          "noise",
        ])
          delete layer[key];
        layer.bind = {
          ...(layer.bind as Record<string, string>),
          fill: undefined,
        };
        delete (layer.bind as Record<string, unknown>).fill;
      }
      return {
        kind: "frame",
        position: { x: 0, y: viewport.height * index },
        size: { w: viewport.width, h: viewport.height },
        clipsContent: true,
        children: [layer],
      };
    }),
  };
}

/** Runtime-only projection of the former DOM wrapper vocabulary to Vision LSML. */
export function prepareEditableBindings(
  document: LSMLDocument,
): Record<string, [string, string]> {
  const positions: Record<string, [string, string]> = {};
  let index = 0;
  const visit = (value: unknown): void => {
    if (!value || typeof value !== "object" || Array.isArray(value)) return;
    const node = value as Record<string, unknown>;
    const universal = node.bindUniversal as Record<string, string> | undefined;
    const animate = node.bindAnimate as Record<string, string> | undefined;
    const bind = { ...(node.bind as Record<string, string> | undefined) };
    const style = { ...(node.bindStyle as Record<string, string> | undefined) };
    const defaults = document.defaults ?? {};
    const translate = animate?.["transform.translate"];
    if (translate) {
      const position = defaults[translate];
      const aliases: [string, string] = positions[translate] ?? [
        `__solar.geometry.n${index}.x`,
        `__solar.geometry.n${index++}.y`,
      ];
      positions[translate] = aliases;
      document.defaults ??= {};
      document.defaults[aliases[0]] = Array.isArray(position) ? position[0] : 0;
      document.defaults[aliases[1]] = Array.isArray(position) ? position[1] : 0;
      bind["position.x"] = aliases[0];
      bind["position.y"] = aliases[1];
    }
    for (const [property, path] of Object.entries(universal ?? {})) {
      if (property === "width" || property === "height") {
        bind[property === "width" ? "size.w" : "size.h"] = path;
      } else if (["visible", "opacity", "rotation"].includes(property))
        bind[property] = path;
    }
    if (node.kind === "text" || node.type === "text") {
      for (const [old, modern] of [
        ["size", "fontSize"],
        ["weight", "fontWeight"],
        ["colour", "color"],
      ]) {
        if (style[old!]) {
          style[modern!] = style[old!]!;
          delete style[old!];
        }
      }
    }
    if (node.kind === "shape" || node.type === "shape") {
      for (const [old, modern] of [
        ["fill", "fill"],
        ["radius", "cornerRadius"],
      ]) {
        if (style[old!]) {
          bind[modern!] = style[old!]!;
          delete style[old!];
        }
      }
    }
    if ((node.kind === "frame" || node.type === "frame") && style.background) {
      bind.fill = style.background;
      delete style.background;
    }
    node.bind = bind;
    node.bindStyle = style;
    delete node.bindUniversal;
    delete node.bindAnimate;
    if (Array.isArray(node.children)) node.children.forEach(visit);
    visit(node.template);
  };
  visit(document.layout);
  return positions;
}
