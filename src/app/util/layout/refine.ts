/**
 * Step 6 of Algorithm 1: refine the placement, exploring only moves that keep
 * the alignment.
 *
 * The greedy pass of placement.ts commits to a position as soon as it picks one,
 * so an element placed early can end up somewhere that only looks wrong once its
 * neighbours exist. This pass revisits those decisions.
 *
 * Two properties matter as much as the improvement itself:
 *
 *  - **Determinism.** The layout re-runs whenever an edit changes the node or
 *    edge count, so typing one attribute name relays out the whole diagram. If
 *    the refinement wandered, the diagram would visibly jump on every keystroke.
 *    All randomness comes from a seeded generator, and every iteration order is
 *    fixed.
 *  - **A bounded cost.** The search runs synchronously on the main thread, so it
 *    stops at whichever comes first of an iteration count and a wall-clock
 *    budget, and it always returns the best arrangement it has seen -- never a
 *    half-explored one.
 */

import { Rect } from "../alignmentCandidates";
import { DIRECTIONS } from "./geometry";
import {
  Segment,
  boundingBox,
  countCrossings,
  countOverlaps,
  isAxisAligned,
  totalLength,
} from "./metrics";
import { TreeLayout } from "./hierarchy";
import { LayoutParams } from "./params";
import { clearanceRect } from "./placement";
import { LayoutGraph, Placement, SkeletonElement, Vec } from "./types";

/**
 * mulberry32: small, fast, and good enough for choosing which element to nudge.
 * The point is that it is seeded, not that it is strong.
 */
export const createRng = (seed: number) => {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
};

/** An overlap is not a trade-off to be priced; it makes an arrangement invalid. */
const OVERLAP_PENALTY = 1e6;

/**
 * ISA links drawn with the subclass at or above its superclass.
 *
 * `candidateCost` prices the same thing while the greedy pass places an element
 * (placement.ts), but it does so one element at a time -- it asks whether *this*
 * candidate would violate the ordering. Over a finished arrangement the question
 * is simply per connector, so this is a plain loop rather than the two-branch
 * form there. Wrapping that form in a loop over the skeleton would match each
 * connector twice, once from each end, and silently double the weight.
 */
export const hierarchyViolations = (graph: LayoutGraph, centres: Placement) => {
  let violations = 0;
  for (const connector of graph.connectors) {
    if (connector.hierarchy === null) continue;
    const parent = centres.get(connector.hierarchy.parentId);
    const child = centres.get(connector.hierarchy.childId);
    if (parent !== undefined && child !== undefined && child.y <= parent.y)
      violations++;
  }
  return violations;
};

const skeletonSegments = (
  graph: LayoutGraph,
  centres: Placement,
): Segment[] => {
  const segments: Segment[] = [];
  const seen = new Set<string>();
  for (const element of graph.skeleton) {
    const from = centres.get(element.id);
    if (from === undefined) continue;
    for (const neighbourId of graph.neighbours.get(element.id) ?? []) {
      const key = [element.id, neighbourId].sort().join("|");
      if (seen.has(key)) continue;
      seen.add(key);
      const to = centres.get(neighbourId);
      if (to !== undefined) segments.push({ a: from, b: to });
    }
  }
  return segments;
};

/** The same terms placement.ts scores a candidate with, over the whole diagram. */
export const layoutCost = (
  graph: LayoutGraph,
  centres: Placement,
  params: LayoutParams,
) => {
  const weights = params.weights;
  const rects: Rect[] = [];
  for (const element of graph.skeleton) {
    const centre = centres.get(element.id);
    if (centre !== undefined)
      rects.push(clearanceRect(element, centre, params, 0));
  }

  const segments = skeletonSegments(graph, centres);
  const box = boundingBox(rects);
  const aspect =
    Math.max(box.width, box.height) /
    Math.max(1, Math.min(box.width, box.height));

  return (
    weights.crossings * countCrossings(segments) +
    weights.length * totalLength(segments) +
    weights.compactness * (box.width + box.height) +
    weights.aspect * aspect +
    weights.unaligned *
      segments.filter((segment) => !isAxisAligned(segment)).length +
    weights.isaDown * hierarchyViolations(graph, centres) +
    OVERLAP_PENALTY * countOverlaps(rects, params.minSeparation)
  );
};

/** How many placed neighbours this element shares a centre line with. */
const alignmentCount = (
  element: SkeletonElement,
  centre: Vec,
  graph: LayoutGraph,
  centres: Placement,
) =>
  (graph.neighbours.get(element.id) ?? []).filter((neighbourId) => {
    const other = centres.get(neighbourId);
    return (
      other !== undefined && (other.x === centre.x || other.y === centre.y)
    );
  }).length;

export type RefineOptions = {
  /** injectable so a test can make the budget expire on demand */
  now?: () => number;
  /**
   * ISA hierarchies, which move as one shape.
   *
   * Only the root is offered to the search; its subclasses travel with it. The
   * tree was arranged to be read as a tree, and a single-vertex walk can only
   * take it apart -- nudging one subclass out of its row cannot be undone one
   * step at a time, so the annealer would never find its way back.
   */
  trees?: TreeLayout[];
};

export const refinePlacement = (
  graph: LayoutGraph,
  centres: Placement,
  params: LayoutParams,
  { now = () => Date.now(), trees = [] }: RefineOptions = {},
): Placement => {
  const treeByRoot = new Map(trees.map((tree) => [tree.rootId, tree]));
  const rides = new Set<string>();
  for (const tree of trees)
    for (const id of tree.offsets.keys()) if (id !== tree.rootId) rides.add(id);

  const movable = graph.skeleton.filter(
    (element) => centres.has(element.id) && !rides.has(element.id),
  );
  if (!params.refine.enabled || movable.length < 3) return centres;

  const random = createRng(params.refine.seed);
  const started = now();

  let current = new Map(centres);
  let currentCost = layoutCost(graph, current, params);
  let currentViolations = hierarchyViolations(graph, current);
  let best = current;
  let bestCost = currentCost;

  // lighter elements move more readily: an entity with many relations is load
  // bearing, and shifting it drags the whole diagram behind it
  const maxWeight = Math.max(...movable.map((element) => element.weight), 1);
  const mobility = movable.map(
    (element) => 1 - (element.weight / (maxWeight + 1)) * 0.8,
  );
  const totalMobility = mobility.reduce((sum, value) => sum + value, 0);

  const pick = () => {
    let target = random() * totalMobility;
    for (let index = 0; index < movable.length; index++) {
      target -= mobility[index];
      if (target <= 0) return index;
    }
    return movable.length - 1;
  };

  const { iterations, timeBudgetMs } = params.refine;

  for (let step = 0; step < iterations; step++) {
    // checked every so often rather than every step; `now` is the only thing
    // here that is not reproducible, and it can only ever end the loop early
    if (step % 32 === 0 && now() - started > timeBudgetMs) break;

    const element = movable[pick()];
    const from = current.get(element.id)!;
    const direction = DIRECTIONS[Math.floor(random() * DIRECTIONS.length)];
    const distance = (1 + Math.floor(random() * 3)) * params.gridStep;
    const to = {
      x: from.x + direction.x * distance,
      y: from.y + direction.y * distance,
    };

    const candidate = new Map(current);
    candidate.set(element.id, to);
    // the whole tree follows its root. Every member is already a key here, so
    // this replaces values without disturbing the map's order -- which the
    // determinism tests compare entry by entry.
    const tree = treeByRoot.get(element.id);
    if (tree !== undefined)
      for (const [id, offset] of tree.offsets)
        if (id !== element.id)
          candidate.set(id, { x: to.x + offset.x, y: to.y + offset.y });

    // the constraint the whole algorithm rests on: a move may not cost the
    // element the alignment it already has
    if (
      alignmentCount(element, to, graph, candidate) <
      alignmentCount(element, from, graph, current)
    )
      continue;

    // the same shape of guard for the hierarchy: a subclass the greedy pass put
    // below its superclass may not be lifted back up. `isaDown` prices this in
    // `layoutCost` as well, but at 15 it is readily outbid by a crossing (100)
    // or the aspect term (25), and pricing alone is what left `bank` drawing its
    // one ISA link sideways. Phrased as "may not increase" rather than "must be
    // zero", so a diagram that starts with violations can still improve.
    const candidateViolations = hierarchyViolations(graph, candidate);
    if (candidateViolations > currentViolations) continue;

    const candidateCost = layoutCost(graph, candidate, params);
    const delta = candidateCost - currentCost;
    // temperature follows the iteration counter, never the clock, so a slow
    // machine explores exactly the same schedule as a fast one
    const temperature = 40 * (1 - step / iterations);
    const accept =
      delta < 0 ||
      (temperature > 0 && random() < Math.exp(-delta / temperature));
    if (!accept) continue;

    current = candidate;
    currentCost = candidateCost;
    currentViolations = candidateViolations;
    if (currentCost < bestCost) {
      best = current;
      bestCost = currentCost;
    }
  }

  return best;
};
