import type { EditableFastPatch, EditableTranslatePatch } from "./patch";
import type { EditablePatchTargets } from "./targets";

export function applyEditableTranslatePatch(
  patch: EditableTranslatePatch,
  root: ParentNode = document,
  priority: "" | "important" = "",
  targets?: EditablePatchTargets,
): boolean {
  let applied = false;
  const nodes =
    targets?.nodes(patch.componentId) ??
    root.querySelectorAll<HTMLElement>("[data-lumencast-bind-animate]");
  for (const node of nodes) {
    if (
      node.getAttribute("data-lumencast-bind-animate") !== patch.componentId
    ) {
      continue;
    }
    const transform = `translate3d(${patch.x}px, ${patch.y}px, 0px)`;
    if (
      node.style.getPropertyValue("transform") !== transform ||
      node.style.getPropertyPriority("transform") !== priority
    ) {
      node.style.willChange = "transform";
      node.style.setProperty("transform", transform, priority);
    }
    applied = true;
  }
  return applied;
}

function editableNode(
  componentId: string,
  root: ParentNode,
  targets?: EditablePatchTargets,
): HTMLElement | null {
  if (targets) return targets.nodes(componentId)[0] ?? null;
  for (const node of root.querySelectorAll<HTMLElement>(
    "[data-lumencast-bind-animate]",
  )) {
    if (node.getAttribute("data-lumencast-bind-animate") === componentId) {
      return node;
    }
  }
  return null;
}

function sizedElements(
  node: HTMLElement,
  targets?: EditablePatchTargets,
): HTMLElement[] {
  return [
    node,
    ...(targets
      ? targets.all<HTMLElement>(node, "div,svg,img,video,canvas")
      : node.querySelectorAll<HTMLElement>("div,svg,img,video,canvas")),
  ];
}

export function applyEditableFastPatch(
  patch: EditableFastPatch,
  root: ParentNode = document,
  priority: "" | "important" = "",
  targets?: EditablePatchTargets,
): boolean {
  if (patch.property === "translate") {
    return applyEditableTranslatePatch(patch, root, priority, targets);
  }
  const node = editableNode(patch.componentId, root, targets);
  if (!node) return false;
  const value = patch.value;
  switch (patch.property) {
    case "width":
    case "height": {
      const cssValue = `${value}px`;
      for (const element of sizedElements(node, targets)) {
        if (priority)
          element.style.setProperty(patch.property, cssValue, priority);
        else element.style[patch.property] = cssValue;
        if (element instanceof SVGElement) {
          element.setAttribute(patch.property, String(value));
          if (patch.property === "width") {
            const height = Number.parseFloat(
              element.getAttribute("height") ?? "0",
            );
            if (height > 0)
              element.setAttribute("viewBox", `0 0 ${value} ${height}`);
          } else {
            const width = Number.parseFloat(
              element.getAttribute("width") ?? "0",
            );
            if (width > 0)
              element.setAttribute("viewBox", `0 0 ${width} ${value}`);
          }
        }
      }
      return true;
    }
    case "visible":
      if (priority) {
        node.style.setProperty(
          "visibility",
          value ? "visible" : "hidden",
          priority,
        );
      } else {
        node.style.visibility = value ? "visible" : "hidden";
      }
      return true;
    case "opacity":
      if (priority) node.style.setProperty("opacity", String(value), priority);
      else node.style.opacity = String(value);
      return true;
    case "rotation":
      if (priority) node.style.setProperty("rotate", `${value}deg`, priority);
      else node.style.rotate = `${value}deg`;
      return true;
    case "zIndex":
      if (priority) node.style.setProperty("z-index", String(value), priority);
      else node.style.zIndex = String(value);
      return true;
    case "value": {
      const text = targets
        ? targets.first<HTMLElement>(node, "span")
        : node.querySelector<HTMLElement>("span");
      if (!text) return false;
      text.textContent = String(value);
      return true;
    }
    case "fontSize":
    case "fontWeight":
    case "colour":
    case "lineHeight": {
      const text = targets
        ? targets.first<HTMLElement>(node, "span")
        : node.querySelector<HTMLElement>("span");
      if (!text) return false;
      if (patch.property === "fontSize") {
        if (priority)
          text.style.setProperty("font-size", `${value}px`, priority);
        else text.style.fontSize = `${value}px`;
      } else if (patch.property === "fontWeight") {
        if (priority)
          text.style.setProperty("font-weight", String(value), priority);
        else text.style.fontWeight = String(value);
      } else if (patch.property === "colour") {
        if (priority) text.style.setProperty("color", String(value), priority);
        else text.style.color = String(value);
      } else if (priority) {
        text.style.setProperty("line-height", String(value), priority);
      } else {
        text.style.lineHeight = String(value);
      }
      return true;
    }
    case "src": {
      const media = targets
        ? targets.first<HTMLImageElement | HTMLMediaElement>(
            node,
            "img,video,audio",
          )
        : node.querySelector<HTMLImageElement | HTMLMediaElement>(
            "img,video,audio",
          );
      if (!media) return false;
      media.src = String(value);
      if (media instanceof HTMLMediaElement)
        void media.play().catch(() => undefined);
      return true;
    }
    case "fill": {
      const selector =
        "svg path,svg rect,svg circle,svg ellipse,svg polygon,svg line";
      const paints = targets
        ? targets.all<SVGElement>(node, selector)
        : node.querySelectorAll<SVGElement>(selector);
      for (const paint of paints) {
        if (paint.getAttribute("fill") !== "none")
          paint.setAttribute("fill", String(value));
      }
      return paints.length > 0;
    }
    case "radius":
      for (const element of sizedElements(node, targets))
        if (priority)
          element.style.setProperty("border-radius", `${value}px`, priority);
        else element.style.borderRadius = `${value}px`;
      return true;
    case "background":
      for (const element of sizedElements(node, targets))
        if (priority)
          element.style.setProperty("background", String(value), priority);
        else element.style.background = String(value);
      return true;
  }
}
