import type { LSMLDocument } from "./native-document";

/** Runtime-only projection of the former DOM wrapper vocabulary to Vision LSML. */
export function prepareEditableBindings(document: LSMLDocument): string[] {
  const geometry = new Set<string>();
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
      geometry.add(translate);
      const position = defaults[translate];
      if (Array.isArray(position) && position.length === 2)
        node.position = { x: position[0], y: position[1] };
    }
    for (const [property, path] of Object.entries(universal ?? {})) {
      if (property === "width" || property === "height") {
        geometry.add(path);
        node.size = {
          ...(node.size as object | undefined),
          [property === "width" ? "w" : "h"]: defaults[path],
        };
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
  return [...geometry];
}
