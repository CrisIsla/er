/**
 * Steps 1-3 of the proposal's Algorithm 1: place the skeleton (entities and
 * aggregation boxes) by discrete search.
 *
 * The idea the whole algorithm turns on: alignment is a *constraint*, not a
 * goal. A new element may only go at `centre[anchor] + k*S*d`, so every position
 * is a whole number of grid steps from an already-placed neighbour, and -- since
 * the seed sits at the origin -- from every other element too. The search space
 * is a few dozen points instead of the plane, and the survivors that share a
 * centre line with the most anchors win outright before cost is even considered.
 */

import { Rect } from "../alignmentCandidates";
import { DIRECTIONS, rectAt, rectsOverlap, snap } from "./geometry";
import { boundingBox, isAxisAligned, segmentLength } from "./metrics";
import { segmentsCross } from "./geometry";
import { LayoutParams } from "./params";
import {
  LayoutElement,
  LayoutGraph,
  Placement,
  SkeletonElement,
  Vec,
} from "./types";

/** Centres are exact multiples of the grid step, so this can be an exact test. */
const EPSILON = 1e-6;

const isAligned = (a: Vec, b: Vec) =>
  Math.abs(a.x - b.x) < EPSILON || Math.abs(a.y - b.y) < EPSILON;

/**
 * The box an element must keep clear: what it covers on screen, grown by the
 * share of its attribute halo we reserve up front.
 */
const clearanceRect = (
  element: LayoutElement,
  centre: Vec,
  params: LayoutParams,
  haloFactor: number,
): Rect => {
  const pad = element.haloRadius * haloFactor;
  return rectAt(
    element.id,
    centre,
    element.visualWidth + 2 * pad,
    element.visualHeight + 2 * pad,
  );
};

/**
 * How much room the connectors joining two elements need between them.
 *
 * Parallel relationships are offset perpendicular to the line joining their
 * participants, so several of them still only need room for one diamond along
 * that line.
 */
const buildConnectorSpans = (graph: LayoutGraph) => {
  const spans = new Map<string, number>();
  for (const connector of graph.connectors) {
    if (connector.participants.length < 2) continue;
    const span = Math.max(connector.visualWidth, connector.visualHeight);
    for (const a of connector.participants)
      for (const b of connector.participants) {
        if (a === b) continue;
        const key = [a, b].sort().join("|");
        spans.set(key, Math.max(spans.get(key) ?? 0, span));
      }
  }
  return spans;
};

/**
 * The first number of grid steps in direction `d` that actually clears both
 * boxes and whatever connector sits between them.
 *
 * The proposal writes candidates as `p + k*S*d` with `1 <= k <= Kmax`. Starting
 * at 1 wastes the whole range on positions buried inside the anchor when the
 * anchor is a 500x500 aggregation box, so the range starts where the two
 * elements stop touching instead. Candidates stay whole multiples of S, which is
 * what keeps the global grid intact.
 */
const firstClearStep = (
  anchor: LayoutElement,
  element: LayoutElement,
  direction: Vec,
  span: number,
  params: LayoutParams,
  haloFactor: number,
  minSeparation: number,
) => {
  const pad = anchor.haloRadius * haloFactor + element.haloRadius * haloFactor;
  const alongX = (anchor.visualWidth + element.visualWidth) / 2 + pad;
  const alongY = (anchor.visualHeight + element.visualHeight) / 2 + pad;
  // a diagonal step moves on both axes at once, so clearing either one is enough
  const extent =
    direction.x !== 0 && direction.y !== 0
      ? Math.min(alongX, alongY)
      : direction.x !== 0
      ? alongX
      : alongY;
  const needed = extent + span + minSeparation;
  return Math.max(1, Math.ceil(needed / params.gridStep));
};

type Relaxation = {
  maxSteps: number;
  minSeparation: number;
  haloFactor: number;
  requireAlignment: boolean;
};

/**
 * The ladder the proposal describes: look further out, then allow elements
 * closer together, and only then give up on alignment.
 */
const relaxations = (params: LayoutParams): Relaxation[] => [
  {
    maxSteps: params.maxSteps,
    minSeparation: params.minSeparation,
    haloFactor: params.haloFactor,
    requireAlignment: true,
  },
  {
    maxSteps: params.relax.maxStepsCeiling,
    minSeparation: params.minSeparation,
    haloFactor: params.haloFactor,
    requireAlignment: true,
  },
  {
    maxSteps: params.relax.maxStepsCeiling,
    minSeparation: params.relax.minSeparationFloor,
    haloFactor: 0,
    requireAlignment: true,
  },
  {
    maxSteps: params.relax.maxStepsCeiling,
    minSeparation: params.relax.minSeparationFloor,
    haloFactor: 0,
    requireAlignment: false,
  },
];

export const generateCandidates = (
  element: LayoutElement,
  anchors: string[],
  centres: Placement,
  graph: LayoutGraph,
  spans: Map<string, number>,
  params: LayoutParams,
  relaxation: Relaxation,
): Vec[] => {
  const seen = new Set<string>();
  const candidates: Vec[] = [];

  for (const anchorId of anchors) {
    const anchor = graph.elements.get(anchorId);
    const anchorCentre = centres.get(anchorId);
    if (!anchor || !anchorCentre) continue;
    const span = spans.get([anchorId, element.id].sort().join("|")) ?? 0;

    for (const direction of DIRECTIONS) {
      const first = firstClearStep(
        anchor,
        element,
        direction,
        span,
        params,
        relaxation.haloFactor,
        relaxation.minSeparation,
      );
      for (let k = first; k < first + relaxation.maxSteps; k++) {
        const candidate = {
          x: anchorCentre.x + k * params.gridStep * direction.x,
          y: anchorCentre.y + k * params.gridStep * direction.y,
        };
        const key = `${candidate.x},${candidate.y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        candidates.push(candidate);
      }
    }
  }
  return candidates;
};

/** Drops candidates that would sit on, or too close to, something already placed. */
export const rejectOccupied = (
  element: LayoutElement,
  candidates: Vec[],
  placedRects: Rect[],
  params: LayoutParams,
  relaxation: Relaxation,
) =>
  candidates.filter((candidate) => {
    const rect = clearanceRect(
      element,
      candidate,
      params,
      relaxation.haloFactor,
    );
    return !placedRects.some((placed) =>
      rectsOverlap(rect, placed, relaxation.minSeparation),
    );
  });

/** The hard constraint: keep only the candidates aligned with the most anchors. */
export const keepMostAligned = (
  candidates: Vec[],
  anchors: string[],
  centres: Placement,
) => {
  if (candidates.length === 0) return candidates;
  const score = (candidate: Vec) =>
    anchors.filter((anchorId) => {
      const anchorCentre = centres.get(anchorId);
      return anchorCentre !== undefined && isAligned(candidate, anchorCentre);
    }).length;

  const best = Math.max(...candidates.map(score));
  return candidates.filter((candidate) => score(candidate) === best);
};

type CostContext = {
  graph: LayoutGraph;
  centres: Placement;
  placedRects: Rect[];
  /** straight lines between the elements already placed */
  existingSegments: { a: Vec; b: Vec }[];
  params: LayoutParams;
};

/**
 * What the proposal calls the aesthetic cost: crossings, edge length, how much
 * the diagram sprawls, and how many of the new edges end up on a slant.
 */
export const candidateCost = (
  element: SkeletonElement,
  candidate: Vec,
  anchors: string[],
  context: CostContext,
) => {
  const { graph, centres, placedRects, existingSegments, params } = context;
  const weights = params.weights;

  const newSegments = anchors
    .map((anchorId) => centres.get(anchorId))
    .filter((centre): centre is Vec => centre !== undefined)
    .map((centre) => ({ a: candidate, b: centre }));

  let crossings = 0;
  for (const fresh of newSegments)
    for (const existing of existingSegments)
      if (segmentsCross(fresh.a, fresh.b, existing.a, existing.b)) crossings++;

  const length = newSegments.reduce(
    (total, segment) => total + segmentLength(segment),
    0,
  );

  const before = boundingBox(placedRects);
  const after = boundingBox([
    ...placedRects,
    clearanceRect(element, candidate, params, 0),
  ]);
  const growth = after.width + after.height - (before.width + before.height);

  // half-perimeter growth alone always prefers whichever side of the box is
  // cheaper to extend, which for boxes wider than they are tall means "down",
  // every single time -- so the diagram has to be pushed back towards square
  const aspect =
    Math.max(after.width, after.height) /
    Math.max(1, Math.min(after.width, after.height));

  const unaligned = newSegments.filter(
    (segment) => !isAxisAligned(segment),
  ).length;

  // a weak nudge, not a hierarchy pass: prefer a subclass drawn below its
  // superclass, which is how people draw ISA trees
  let hierarchyViolations = 0;
  for (const connector of graph.connectors) {
    if (connector.hierarchy === null) continue;
    const { parentId, childId } = connector.hierarchy;
    if (childId === element.id) {
      const parentCentre = centres.get(parentId);
      if (parentCentre !== undefined && candidate.y <= parentCentre.y)
        hierarchyViolations++;
    } else if (parentId === element.id) {
      const childCentre = centres.get(childId);
      if (childCentre !== undefined && candidate.y >= childCentre.y)
        hierarchyViolations++;
    }
  }

  return (
    weights.crossings * crossings +
    weights.length * length +
    weights.compactness * growth +
    weights.aspect * aspect +
    weights.unaligned * unaligned +
    weights.isaDown * hierarchyViolations
  );
};

/**
 * A component that shares no connector with anything placed so far. It goes to
 * the right of everything else, on the grid.
 *
 * The pseudocode has no branch for this, but it has to exist: `roles.json` is a
 * single entity with a recursive relationship, so the anchor set is empty from
 * the very first iteration and no amount of relaxing produces a candidate.
 */
const placeBesideDiagram = (
  element: LayoutElement,
  placedRects: Rect[],
  params: LayoutParams,
): Vec => {
  if (placedRects.length === 0) return { x: 0, y: 0 };
  const box = boundingBox(placedRects);
  const halfWidth =
    element.visualWidth / 2 + element.haloRadius * params.haloFactor;
  const x =
    Math.ceil(
      (box.x + box.width + params.minSeparation + halfWidth) / params.gridStep,
    ) * params.gridStep;
  return { x, y: snap(box.y + box.height / 2, params.gridStep) };
};

/** Weight first, then how connected it is, then a stable name. */
const seedOrder = (graph: LayoutGraph) =>
  [...graph.skeleton].sort(
    (a, b) =>
      b.weight - a.weight ||
      (graph.neighbours.get(b.id)?.length ?? 0) -
        (graph.neighbours.get(a.id)?.length ?? 0) ||
      a.key.localeCompare(b.key),
  );

export const placeSkeleton = (
  graph: LayoutGraph,
  params: LayoutParams,
): Placement => {
  const centres: Placement = new Map();
  if (graph.skeleton.length === 0) return centres;

  const spans = buildConnectorSpans(graph);
  const ordered = seedOrder(graph);
  const placedRects: Rect[] = [];
  const existingSegments: { a: Vec; b: Vec }[] = [];

  const commit = (element: SkeletonElement, centre: Vec) => {
    centres.set(element.id, centre);
    placedRects.push(clearanceRect(element, centre, params, params.haloFactor));
    for (const neighbourId of graph.neighbours.get(element.id) ?? []) {
      const neighbourCentre = centres.get(neighbourId);
      if (neighbourCentre !== undefined)
        existingSegments.push({ a: centre, b: neighbourCentre });
    }
  };

  // step 2: the heaviest element anchors the whole diagram at the origin
  commit(ordered[0], { x: 0, y: 0 });

  const remaining = new Set(ordered.slice(1).map((element) => element.id));

  while (remaining.size > 0) {
    // step 3: whichever unplaced element is pinned down by the most neighbours
    const next = ordered
      .filter((element) => remaining.has(element.id))
      .map((element) => ({
        element,
        anchors: (graph.neighbours.get(element.id) ?? []).filter((id) =>
          centres.has(id),
        ),
      }))
      .sort(
        (a, b) =>
          b.anchors.length - a.anchors.length ||
          b.element.weight - a.element.weight ||
          a.element.key.localeCompare(b.element.key),
      )[0];

    const { element, anchors } = next;
    remaining.delete(element.id);

    if (anchors.length === 0) {
      commit(element, placeBesideDiagram(element, placedRects, params));
      continue;
    }

    // anchors are visited in a fixed order so the candidate list, and therefore
    // the winner among equal-cost candidates, never depends on Map iteration
    const orderedAnchors = [...anchors].sort((a, b) =>
      (graph.elements.get(a)?.key ?? a).localeCompare(
        graph.elements.get(b)?.key ?? b,
      ),
    );

    let chosen: Vec | null = null;
    for (const relaxation of relaxations(params)) {
      const candidates = rejectOccupied(
        element,
        generateCandidates(
          element,
          orderedAnchors,
          centres,
          graph,
          spans,
          params,
          relaxation,
        ),
        placedRects,
        params,
        relaxation,
      );
      const survivors = relaxation.requireAlignment
        ? keepMostAligned(candidates, orderedAnchors, centres)
        : candidates;
      if (survivors.length === 0) continue;

      const context = {
        graph,
        centres,
        placedRects,
        existingSegments,
        params,
      };
      chosen = survivors.reduce((best, candidate) =>
        candidateCost(element, candidate, orderedAnchors, context) <
        candidateCost(element, best, orderedAnchors, context)
          ? candidate
          : best,
      );
      break;
    }

    commit(element, chosen ?? placeBesideDiagram(element, placedRects, params));
  }

  return centres;
};

export { clearanceRect, firstClearStep, relaxations, seedOrder };
