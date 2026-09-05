/**
 * The ISA forest: which entity is whose superclass, and how deep each one sits.
 *
 * An entity has at most one parent -- `Entity.parentName` is a single field
 * (ERDoc/types/parser/Entity.ts:16) -- so inheritance is a forest rather than a
 * general DAG, and a subclass sits on exactly one row below its superclass. That
 * is what lets the tree pass below draw a fan instead of a layered graph.
 *
 * The links are read from `connector.hierarchy` rather than from the ERdoc, so
 * every guard `buildLayoutGraph` already applies is inherited: `hierarchyOf`
 * returns null unless both ends are skeleton elements (buildLayoutGraph.ts:116),
 * and an `extends` naming an entity that does not exist never becomes a
 * connector with two participants at all.
 */

import { LayoutParams } from "./params";
import { LayoutGraph, SkeletonElement, Vec } from "./types";

export type HierarchyLink = { parentId: string; childId: string };

export type HierarchyForest = {
  /** the links that survived the cycle check, in a stable order */
  links: HierarchyLink[];
  /** superclass -> its direct subclasses, in the order the ERdoc declares them */
  childrenOf: Map<string, string[]>;
  parentOf: Map<string, string>;
  /** 0 for a root, one more than the parent for everything else */
  layerOf: Map<string, number>;
  /** the superclasses that are nobody's subclass */
  roots: string[];
  /** every member -> the root of the tree it belongs to */
  rootOf: Map<string, string>;
  /** root -> every member of its tree, roots first, then by layer */
  membersOf: Map<string, string[]>;
};

const EMPTY: HierarchyForest = {
  links: [],
  childrenOf: new Map(),
  parentOf: new Map(),
  layerOf: new Map(),
  roots: [],
  rootOf: new Map(),
  membersOf: new Map(),
};

/**
 * Walks up from `id` and reports whether it ever comes back.
 *
 * `entity Dog extends Animal {} / entity Animal extends Dog {}` parses cleanly:
 * the cycle is only a lint error (linter/entity/checkEntityExtendsChild.ts), and
 * neither the app nor the layout tests gate on the linter. Left alone it would
 * send the recursion below into an infinite walk, so the link that closes the
 * cycle is dropped and both entities fall back to being ordinary elements.
 */
const closesACycle = (
  childId: string,
  parentId: string,
  parentOf: Map<string, string>,
) => {
  const seen = new Set<string>([childId]);
  let current: string | undefined = parentId;
  while (current !== undefined) {
    if (seen.has(current)) return true;
    seen.add(current);
    current = parentOf.get(current);
  }
  return false;
};

/**
 * @param order input node ids, so siblings can be drawn in the order the ERdoc
 *   declares them. Sorting by `key` instead would put `CEO` left of `Manager`
 *   whatever the user wrote.
 */
export const buildHierarchyForest = (
  graph: LayoutGraph,
  order: string[] = [],
): HierarchyForest => {
  const declared = new Map(order.map((id, index) => [id, index]));
  const rank = (id: string) => declared.get(id) ?? Number.MAX_SAFE_INTEGER;

  // sorted before anything is decided, so which link wins a conflict -- and
  // therefore the whole forest -- never depends on Map iteration order
  const candidates = graph.connectors
    .filter((connector) => connector.hierarchy !== null)
    .map((connector) => ({ ...connector.hierarchy!, key: connector.key }))
    .sort((a, b) => a.key.localeCompare(b.key));
  if (candidates.length === 0) return EMPTY;

  const parentOf = new Map<string, string>();
  const links: HierarchyLink[] = [];
  for (const { parentId, childId } of candidates) {
    // the parser allows one parent per entity, but `hierarchyOf` enforces no
    // uniqueness and layoutDiscreteSearch is reachable without the linter, so
    // the second claim on a subclass is dropped rather than trusted
    if (parentId === childId || parentOf.has(childId)) continue;
    if (closesACycle(childId, parentId, parentOf)) continue;
    parentOf.set(childId, parentId);
    links.push({ parentId, childId });
  }
  if (links.length === 0) return EMPTY;

  const childrenOf = new Map<string, string[]>();
  for (const { parentId, childId } of links)
    childrenOf.set(parentId, [...(childrenOf.get(parentId) ?? []), childId]);
  for (const children of childrenOf.values())
    children.sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  const roots = [...childrenOf.keys()]
    .filter((id) => !parentOf.has(id))
    .sort((a, b) => rank(a) - rank(b) || a.localeCompare(b));

  // one walk down from each root: every member is reached exactly once, because
  // parentOf is a function and the cycle check above makes it acyclic
  const layerOf = new Map<string, number>();
  const rootOf = new Map<string, string>();
  const membersOf = new Map<string, string[]>();
  for (const root of roots) {
    const members: string[] = [];
    const queue: string[] = [root];
    layerOf.set(root, 0);
    while (queue.length > 0) {
      const id = queue.shift()!;
      members.push(id);
      rootOf.set(id, root);
      for (const child of childrenOf.get(id) ?? []) {
        layerOf.set(child, layerOf.get(id)! + 1);
        queue.push(child);
      }
    }
    membersOf.set(root, members);
  }

  return { links, childrenOf, parentOf, layerOf, roots, rootOf, membersOf };
};

/**
 * One arranged hierarchy: where every member sits relative to its root.
 *
 * Offsets rather than absolute centres, because the search decides where the
 * root goes and the whole tree travels with it. They are centre-to-centre: the
 * members differ in height, so top-left offsets would shear the rows.
 */
export type TreeLayout = {
  rootId: string;
  /** member id -> centre, relative to the root's centre */
  offsets: Map<string, Vec>;
  /** ISA connector id -> centre, relative to the root's centre */
  triangles: Map<string, Vec>;
  /** the room the whole tree needs, as `SkeletonElement.footprint` wants it */
  footprint: { dx: number; dy: number; width: number; height: number };
};

/**
 * Columns are the unit the tree is arranged in, and they are kept a multiple of
 * four so the arithmetic never leaves the grid.
 *
 * A parent is centred between its outer children, i.e. at half the sum of two
 * child centres. Each child centre carries a `subtree/2`, so halving again is
 * only exact when every subtree is a multiple of four -- with merely even
 * subtrees a parent of a 2-column and a 4-column child lands on a half column,
 * 30px off the lattice, and the exact `isAligned` test in placement.ts stops
 * seeing alignments that are there.
 */
const COLUMN_QUANTUM = 4;

const roundUpTo = (value: number, step: number) =>
  Math.ceil(value / step) * step;

/**
 * The horizontal room one member needs, in columns.
 *
 * The *full* attribute halo, not the `haloFactor` share the search reserves.
 * That fraction is justified by attributes being steered into whichever sector
 * is free, but inside a tree the vertical sectors are spoken for by the trunk,
 * so sideways is where the ring actually goes.
 */
const slotColumns = (element: SkeletonElement, params: LayoutParams) =>
  Math.max(
    COLUMN_QUANTUM,
    roundUpTo(
      Math.ceil(
        (element.visualWidth + 2 * element.haloRadius + params.minSeparation) /
          params.gridStep,
      ),
      COLUMN_QUANTUM,
    ),
  );

/** Half a member's vertical reach, including the share of the halo drawn above and below. */
const halfHeight = (element: SkeletonElement, params: LayoutParams) =>
  element.visualHeight / 2 + element.haloRadius * params.haloFactor;

export const layoutHierarchyTree = (
  forest: HierarchyForest,
  rootId: string,
  graph: LayoutGraph,
  params: LayoutParams,
): TreeLayout | null => {
  const members = forest.membersOf.get(rootId) ?? [];
  const skeletonOf = (id: string) => {
    const element = graph.elements.get(id);
    return element !== undefined && element.role === "skeleton"
      ? element
      : null;
  };
  if (members.some((id) => skeletonOf(id) === null)) return null;

  // --- rows: one y per layer, deep enough for the triangles that sit between ---
  const byLayer = new Map<number, SkeletonElement[]>();
  for (const id of members) {
    const layer = forest.layerOf.get(id)!;
    byLayer.set(layer, [...(byLayer.get(layer) ?? []), skeletonOf(id)!]);
  }
  const depth = Math.max(...byLayer.keys());

  const triangleHeight = Math.max(
    ...graph.connectors
      .filter(
        (connector) =>
          connector.hierarchy !== null &&
          forest.rootOf.get(connector.hierarchy.childId) === rootId,
      )
      .map((connector) => connector.visualHeight),
    0,
  );

  const rowY: number[] = [0];
  for (let layer = 1; layer <= depth; layer++) {
    const above = Math.max(
      ...byLayer.get(layer - 1)!.map((element) => halfHeight(element, params)),
    );
    const below = Math.max(
      ...byLayer.get(layer)!.map((element) => halfHeight(element, params)),
    );
    const needed =
      above +
      params.minSeparation +
      triangleHeight +
      params.minSeparation +
      below;
    rowY[layer] =
      rowY[layer - 1] + roundUpTo(Math.ceil(needed), params.gridStep);
  }

  // --- columns: Reingold-Tilford, bottom up, in whole columns ---
  const column = new Map<string, number>();
  const descendants = (id: string): string[] => [
    id,
    ...(forest.childrenOf.get(id) ?? []).flatMap(descendants),
  ];

  /** Arranges `id`'s subtree with `id` at column 0, and reports its extent. */
  const arrange = (id: string): { lo: number; hi: number } => {
    const element = skeletonOf(id)!;
    const half = slotColumns(element, params) / 2;
    const children = forest.childrenOf.get(id) ?? [];

    if (children.length === 0) {
      column.set(id, 0);
      return { lo: -half, hi: half };
    }

    let cursor = 0;
    let lo = Infinity;
    let hi = -Infinity;
    for (const child of children) {
      const span = arrange(child);
      // butt this subtree against the last one; the separation is already
      // inside every slot, so no extra gap is added here
      const shift = cursor - span.lo;
      for (const member of descendants(child))
        column.set(member, column.get(member)! + shift);
      lo = Math.min(lo, span.lo + shift);
      hi = Math.max(hi, span.hi + shift);
      cursor = span.hi + shift;
    }

    // centred between the outer children, which is exact because every subtree
    // is a whole number of COLUMN_QUANTUM columns
    const first = column.get(children[0])!;
    const last = column.get(children[children.length - 1])!;
    const centre = (first + last) / 2;
    column.set(id, centre);

    // a parent wider than the span it sits over still has to fit
    return { lo: Math.min(lo, centre - half), hi: Math.max(hi, centre + half) };
  };

  const span = arrange(rootId);
  const rootColumn = column.get(rootId)!;

  const offsets = new Map<string, Vec>();
  for (const id of members)
    offsets.set(id, {
      x: (column.get(id)! - rootColumn) * params.gridStep,
      y: rowY[forest.layerOf.get(id)!],
    });

  // --- the triangles, seated on the trunk directly above each subclass ---
  const triangles = new Map<string, Vec>();
  for (const connector of graph.connectors) {
    if (connector.hierarchy === null) continue;
    const { parentId, childId } = connector.hierarchy;
    if (forest.parentOf.get(childId) !== parentId) continue;
    if (forest.rootOf.get(childId) !== rootId) continue;
    const child = offsets.get(childId);
    const childElement = skeletonOf(childId);
    if (child === undefined || childElement === null) continue;
    // x on the child's own column, so useEdgePath takes its vertical branch and
    // the edge leaves the apex handle DefaultIsA pushes down to `top: 106%`
    triangles.set(connector.id, {
      x: child.x,
      y:
        child.y -
        (childElement.visualHeight / 2 +
          params.minSeparation +
          connector.visualHeight / 2),
    });
  }

  // --- the box the search has to keep clear for all of it ---
  const left = (span.lo - rootColumn) * params.gridStep;
  const right = (span.hi - rootColumn) * params.gridStep;
  const rootElement = skeletonOf(rootId)!;
  const top = -halfHeight(rootElement, params);
  const bottom =
    rowY[depth] +
    Math.max(
      ...byLayer.get(depth)!.map((element) => halfHeight(element, params)),
    );

  return {
    rootId,
    offsets,
    triangles,
    footprint: {
      dx: (left + right) / 2,
      dy: (top + bottom) / 2,
      width: right - left,
      height: bottom - top,
    },
  };
};

/** Every hierarchy in the diagram big enough to be worth arranging as a tree. */
export const hierarchyTrees = (
  graph: LayoutGraph,
  order: string[],
  params: LayoutParams,
): TreeLayout[] => {
  if (!params.hierarchy.enabled) return [];
  const forest = buildHierarchyForest(graph, order);
  const trees: TreeLayout[] = [];
  for (const root of forest.roots) {
    const members = forest.membersOf.get(root) ?? [];
    if (members.length < params.hierarchy.minMembers) continue;
    const layout = layoutHierarchyTree(forest, root, graph, params);
    if (layout !== null) trees.push(layout);
  }
  return trees;
};
