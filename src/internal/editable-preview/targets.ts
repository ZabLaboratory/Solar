/** DOM selections retained only while editable-preview patches are converging. */
export class EditablePatchTargets {
  private bindings: Map<string, HTMLElement[]> | null = null;
  private firstSelections = new WeakMap<
    ParentNode,
    Map<string, Element | null>
  >();
  private allSelections = new WeakMap<ParentNode, Map<string, Element[]>>();
  private readonly observer: MutationObserver;

  constructor(private readonly root: ParentNode) {
    this.observer = new MutationObserver((records) => this.invalidate(records));
    this.observer.observe(root as Node, {
      subtree: true,
      childList: true,
      attributes: true,
      attributeFilter: ["data-lumencast-bind-animate"],
    });
  }

  nodes(componentId: string): readonly HTMLElement[] {
    // A patch can follow a DOM mutation in the same task, before the observer's
    // callback. Drain those records before trusting any cached selection.
    this.invalidate(this.observer.takeRecords());
    if (this.bindings === null) {
      this.bindings = new Map();
      for (const node of this.root.querySelectorAll<HTMLElement>(
        "[data-lumencast-bind-animate]",
      )) {
        const id = node.getAttribute("data-lumencast-bind-animate");
        if (id === null) continue;
        const matches = this.bindings.get(id);
        if (matches) matches.push(node);
        else this.bindings.set(id, [node]);
      }
    }
    return this.bindings.get(componentId) ?? [];
  }

  first<T extends Element>(root: ParentNode, selector: string): T | null {
    let selections = this.firstSelections.get(root);
    if (!selections) {
      selections = new Map();
      this.firstSelections.set(root, selections);
    }
    if (!selections.has(selector)) {
      selections.set(selector, root.querySelector(selector));
    }
    return selections.get(selector) as T | null;
  }

  all<T extends Element>(root: ParentNode, selector: string): readonly T[] {
    let selections = this.allSelections.get(root);
    if (!selections) {
      selections = new Map();
      this.allSelections.set(root, selections);
    }
    let matches = selections.get(selector);
    if (!matches) {
      matches = [...root.querySelectorAll(selector)];
      selections.set(selector, matches);
    }
    return matches as T[];
  }

  dispose(): void {
    this.observer.disconnect();
    this.clear();
  }

  private invalidate(records: MutationRecord[]): void {
    for (const record of records) {
      // Text-node writes cannot change an element selector's result. Ignoring
      // them also prevents accepted text patches from invalidating themselves.
      if (
        record.type === "attributes" ||
        [...record.addedNodes, ...record.removedNodes].some(
          (node) => node.nodeType === 1,
        )
      ) {
        this.clear();
        return;
      }
    }
  }

  private clear(): void {
    this.bindings = null;
    this.firstSelections = new WeakMap();
    this.allSelections = new WeakMap();
  }
}
