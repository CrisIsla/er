/**
 * Undo and redo for the diagram's layout: where the nodes sit, and the size of
 * the ones whose size is somebody's choice (`readNodeSize`).
 *
 * The code has its own history -- Monaco's -- so this one only ever holds what
 * the user did in the diagram: a drag, an arrow-key nudge, a resize, a layout.
 * Each is recorded as the nodes it changed, before and after.
 *
 * Nodes are known by `layoutKey` rather than by id. Ids are array indices that
 * shift whenever a code edit adds or removes something ahead of a node (see
 * erToReactflowElements), so an id-keyed step would put a position on whatever
 * node took that index over.
 *
 * Undo puts a node back only while it is still where the step left it -- the
 * rule Y.UndoManager applies per key. Anything that moved it since, a peer in a
 * shared diagram or a code edit that re-parented it, wins, and the rest of the
 * step is undone without it. A step with nothing left to undo is dropped, so
 * Ctrl+Z never does nothing while there is something older to undo.
 *
 * Pure, so the whole rule can be tested without React Flow.
 */

import { NodeSize, StyledNode, readNodeSize, withNodeSize } from "./nodeSize";

type Position = { x: number; y: number };

/** The parts of a React Flow node this module reads. */
export type LayoutNode = StyledNode & {
  id: string;
  type?: string;
  position: Position;
  parentNode?: string;
  data?: { erId?: string };
};

/**
 * What a node is, independently of its index id. The type is part of it
 * because an aggregation and an entity share the `entity:` erId prefix.
 */
export const layoutKey = (node: LayoutNode): string =>
  `${node.type ?? ""}|${node.data?.erId ?? node.id}`;

/**
 * Where a node sits. The position is relative to the parent, so it only means
 * something under the same one -- which is why the parent is part of it.
 */
export type Layout = {
  position: Position;
  size: NodeSize | null;
  parent: string | null;
};

export type LayoutSnapshot = Map<string, Layout>;

export const snapshotLayout = (nodes: LayoutNode[]): LayoutSnapshot => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const snapshot: LayoutSnapshot = new Map();
  for (const node of nodes) {
    const parent =
      node.parentNode === undefined ? undefined : byId.get(node.parentNode);
    snapshot.set(layoutKey(node), {
      position: { x: node.position.x, y: node.position.y },
      size: readNodeSize(node),
      parent:
        parent === undefined ? node.parentNode ?? null : layoutKey(parent),
    });
  }
  return snapshot;
};

const sameSize = (a: NodeSize | null, b: NodeSize | null) =>
  a === null || b === null
    ? a === b
    : a.width === b.width && a.height === b.height;

const sameLayout = (a: Layout, b: Layout) =>
  a.parent === b.parent &&
  a.position.x === b.position.x &&
  a.position.y === b.position.y &&
  sameSize(a.size, b.size);

/** One node a step changed. */
export type LayoutChange = { key: string; before: Layout; after: Layout };

/** What the user did in one go: the nodes it changed. */
export type LayoutStep = LayoutChange[];

/** The nodes a gesture can have moved, or all of them. */
export type Scope = Set<string> | "all";

/**
 * The nodes in `scope` whose layout differs between the two snapshots.
 *
 * A node only in one of them was added or removed, and one whose parent
 * changed sits in another frame; neither has a before and after to compare.
 */
export const diffLayouts = (
  before: LayoutSnapshot,
  after: LayoutSnapshot,
  scope: Scope,
): LayoutStep => {
  const changes: LayoutStep = [];
  for (const [key, was] of before) {
    if (scope !== "all" && !scope.has(key)) continue;
    const now = after.get(key);
    if (now === undefined || now.parent !== was.parent) continue;
    if (!sameLayout(was, now)) changes.push({ key, before: was, after: now });
  }
  return changes;
};

/** Whether the node already sits where the layout puts it. */
export const isLaidOut = (node: LayoutNode, layout: Layout) =>
  node.position.x === layout.position.x &&
  node.position.y === layout.position.y &&
  (layout.size === null || sameSize(readNodeSize(node), layout.size));

/**
 * The node, put where the layout says -- the same recipe ErDiagram uses to
 * land a stored layout.
 */
export const withLayout = <T extends LayoutNode>(
  node: T,
  layout: Layout,
): T => {
  const moved = { ...node, position: { ...layout.position } };
  return layout.size === null ? moved : withNodeSize(moved, layout.size);
};

/** The nodes, with the given layouts put back. The others keep their identity. */
export const withLayouts = <T extends LayoutNode>(
  nodes: T[],
  layouts: Map<string, Layout>,
): T[] =>
  nodes.map((node) => {
    const layout = layouts.get(layoutKey(node));
    return layout === undefined ? node : withLayout(node, layout);
  });

/**
 * - `pointer`: a drag, of nodes or of the selection box, or a resize. Ends when
 *   the pointer is released.
 * - `nudge`: arrow-key moves, which have no start or end of their own; a run of
 *   them is one step.
 * - `layout`: an auto layout, from the click to the layout landing.
 */
export type GestureKind = "pointer" | "nudge" | "layout";

type Pending = {
  kind: GestureKind;
  scope: Scope;
  before: LayoutSnapshot;
  token: number;
};

const MAX_STEPS = 100;

export class LayoutHistory {
  private undoStack: LayoutStep[] = [];
  private redoStack: LayoutStep[] = [];
  private pending: Pending | null = null;
  private lastToken = 0;

  constructor(private readonly maxSteps = MAX_STEPS) {}

  /** The gesture under way, if any. */
  get pendingKind(): GestureKind | null {
    return this.pending?.kind ?? null;
  }

  /** Names the gesture under way, for a commit that must end only that one. */
  get pendingToken(): number | null {
    return this.pending?.token ?? null;
  }

  /**
   * Starts recording a gesture from `current`. One still pending is committed
   * first, and returned when it recorded a step, so it can be persisted.
   */
  begin(kind: GestureKind, scope: Scope, current: LayoutSnapshot) {
    const committed = this.pending === null ? null : this.commit(current);
    this.pending = { kind, scope, before: current, token: ++this.lastToken };
    return { token: this.lastToken, committed };
  }

  /** Widens the pending gesture to more nodes -- a nudge reaching new ones. */
  include(keys: Iterable<string>) {
    const scope = this.pending?.scope;
    if (scope === undefined || scope === "all") return;
    for (const key of keys) scope.add(key);
  }

  /**
   * Ends the pending gesture -- only if it is the one `token` names, when
   * given: a commit that arrives late must not end a gesture begun since,
   * which already committed the one it was for. Returns the step recorded, if
   * the gesture changed anything.
   */
  commit(current: LayoutSnapshot, token?: number): LayoutStep | null {
    const pending = this.pending;
    if (pending === null) return null;
    if (token !== undefined && token !== pending.token) return null;
    this.pending = null;
    const step = diffLayouts(pending.before, current, pending.scope);
    if (step.length === 0) return null;
    this.undoStack.push(step);
    if (this.undoStack.length > this.maxSteps) this.undoStack.shift();
    this.redoStack = [];
    return step;
  }

  /**
   * The layouts that undo the latest step still undoable from `current`, or
   * null. Refuses while a gesture is under way: its nodes are still moving.
   */
  undo(current: LayoutSnapshot): Map<string, Layout> | null {
    if (this.pending !== null) return null;
    return this.travel(current, this.undoStack, this.redoStack, "back");
  }

  /** The mirror of `undo`. */
  redo(current: LayoutSnapshot): Map<string, Layout> | null {
    if (this.pending !== null) return null;
    return this.travel(current, this.redoStack, this.undoStack, "forward");
  }

  clear() {
    this.undoStack = [];
    this.redoStack = [];
    this.pending = null;
  }

  /**
   * Carries the history over to new keys -- an element renamed in the code
   * is the same element, and its steps should follow it. `renames` maps each
   * old key to its new one.
   */
  rekey(renames: Map<string, string>) {
    if (renames.size === 0) return;
    const renamed = (key: string) => renames.get(key) ?? key;
    const relayout = (layout: Layout): Layout =>
      layout.parent === null || !renames.has(layout.parent)
        ? layout
        : { ...layout, parent: renamed(layout.parent) };
    const restep = (step: LayoutStep): LayoutStep =>
      step.map((change) => ({
        key: renamed(change.key),
        before: relayout(change.before),
        after: relayout(change.after),
      }));

    this.undoStack = this.undoStack.map(restep);
    this.redoStack = this.redoStack.map(restep);
    if (this.pending !== null) {
      const { before, scope } = this.pending;
      this.pending = {
        ...this.pending,
        before: new Map(
          [...before].map(([key, layout]) => [renamed(key), relayout(layout)]),
        ),
        scope: scope === "all" ? scope : new Set([...scope].map(renamed)),
      };
    }
  }

  private travel(
    current: LayoutSnapshot,
    from: LayoutStep[],
    to: LayoutStep[],
    direction: "back" | "forward",
  ): Map<string, Layout> | null {
    while (from.length > 0) {
      const step = from.pop()!;
      const stillThere = (change: LayoutChange) => {
        const now = current.get(change.key);
        const expected = direction === "back" ? change.after : change.before;
        return now !== undefined && sameLayout(now, expected);
      };
      // A box and the nodes in it go back together or not at all: a box
      // resized back without a member somebody has moved since could leave the
      // member outside it. Boxes nest, so a unit is the outermost box above.
      const boxes = new Set(
        step.filter((change) => change.after.size !== null).map((c) => c.key),
      );
      const parentOf = new Map(step.map((c) => [c.key, c.after.parent]));
      const unitOf = (change: LayoutChange) => {
        let unit = change.key;
        let parent = change.after.parent;
        while (parent !== null && boxes.has(parent) && parent !== unit) {
          unit = parent;
          parent = parentOf.get(parent) ?? null;
        }
        return unit;
      };
      const moved = new Set(
        step.filter((change) => !stillThere(change)).map(unitOf),
      );
      // only the nodes still where this step left them
      const applicable = step.filter((change) => !moved.has(unitOf(change)));
      if (applicable.length === 0) continue;
      to.push(applicable);
      return new Map(
        applicable.map((change) => [
          change.key,
          direction === "back" ? change.before : change.after,
        ]),
      );
    }
    return null;
  }
}
