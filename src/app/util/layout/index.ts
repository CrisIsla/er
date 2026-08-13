/**
 * The discrete-search layout, end to end.
 *
 * Runs the phases of the proposal's Algorithm 1 in order, then converts the
 * absolute centres the algorithm works in into the top-left, parent-relative
 * positions React Flow expects.
 *
 * The returned map is **total over the input ids**: every node gets a position,
 * including hidden attributes, the contents of aggregations and anything the
 * algorithm chose not to move. Both callers of a layout do
 * `layouted.find(...)?.position` and assert it non-null, so a missing entry
 * becomes `translate(NaN, NaN)` and takes the canvas down with it.
 */

import { placeAttributes } from "./attributes";
import {
  LayoutInputEdge,
  LayoutInputNode,
  buildLayoutGraph,
} from "./buildLayoutGraph";
import { placeConnectors } from "./connectors";
import { rectAt } from "./geometry";
import { boundingBox } from "./metrics";
import { DEFAULT_LAYOUT_PARAMS, LayoutParams } from "./params";
import { placeSkeleton } from "./placement";
import { refinePlacement } from "./refine";
import { LayoutGraph, Placement, Vec } from "./types";

export type LayoutPositions = Map<string, Vec>;

/**
 * Tighter parameters for the inside of an aggregation, which has to fit in the
 * container's box rather than spread across the canvas.
 */
const interiorParams = (params: LayoutParams): LayoutParams => ({
  ...params,
  gridStep: Math.max(20, Math.round(params.gridStep * 0.7)),
  minSeparation: Math.max(10, Math.round(params.minSeparation * 0.5)),
  attributeGap: Math.max(10, Math.round(params.attributeGap * 0.6)),
  haloFactor: params.haloFactor * 0.5,
  margin: 12,
});

const nearestAggregationAncestor = (
  node: LayoutInputNode,
  byId: Map<string, LayoutInputNode>,
) => {
  let parentId = node.parentNode;
  const seen = new Set<string>([node.id]);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (parent === undefined) return null;
    if (parent.type === "aggregation") return parent;
    parentId = parent.parentNode;
  }
  return null;
};

const depthOf = (
  node: LayoutInputNode,
  byId: Map<string, LayoutInputNode>,
): number => {
  const parent = nearestAggregationAncestor(node, byId);
  return parent === null ? 0 : 1 + depthOf(parent, byId);
};

/**
 * Lays out the contents of every aggregation in its container's own frame.
 *
 * erToReactflowElements drops every member at {0, 0} when it builds the box
 * (erToReactflowElements.ts:374) -- the pile-up in the corner the proposal
 * records as figure 10(b) -- so leaving the contents alone is not an option.
 * The search is simply run again on the member sub-diagram: members are children
 * of the container, so the coordinates it produces are already in the frame
 * React Flow wants, and they are then centred and clamped inside the box that
 * `extent: "parent"` will hold them to.
 */
const layoutAggregationInteriors = (
  nodes: LayoutInputNode[],
  edges: LayoutInputEdge[],
  params: LayoutParams,
  positions: LayoutPositions,
) => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const members = new Map<string, LayoutInputNode[]>();
  for (const node of nodes) {
    const container = nearestAggregationAncestor(node, byId);
    if (container === null) continue;
    members.set(container.id, [...(members.get(container.id) ?? []), node]);
  }

  // deepest first, so a nested container is already arranged before the box
  // around it is asked to place it
  const containers = [...members.keys()]
    .map((id) => byId.get(id)!)
    .sort(
      (a, b) => depthOf(b, byId) - depthOf(a, byId) || a.id.localeCompare(b.id),
    );

  for (const container of containers) {
    const inside = members.get(container.id)!;
    const insideIds = new Set(inside.map((node) => node.id));
    const insideEdges = edges.filter(
      (edge) => insideIds.has(edge.source) && insideIds.has(edge.target),
    );

    const local = layoutDiscreteSearch(
      inside,
      insideEdges,
      interiorParams(params),
    );

    const boxWidth = container.width || 500;
    const boxHeight = container.height || 500;
    const rects = inside.map((node) => {
      const position = local.get(node.id) ?? node.position;
      return {
        node,
        x: position.x,
        y: position.y,
        width: node.width || 90,
        height: node.height || 44,
      };
    });
    const minX = Math.min(...rects.map((rect) => rect.x));
    const minY = Math.min(...rects.map((rect) => rect.y));
    const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
    const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));

    // centre the contents in the box, then hold them inside it: React Flow
    // clamps `extent: "parent"` children on drag, so anything left outside would
    // teleport the first time the user touched it
    const shiftX = (boxWidth - (maxX - minX)) / 2 - minX;
    const shiftY = (boxHeight - (maxY - minY)) / 2 - minY;

    for (const rect of rects)
      positions.set(rect.node.id, {
        x: Math.min(
          Math.max(rect.x + shiftX, 0),
          Math.max(boxWidth - rect.width, 0),
        ),
        y: Math.min(
          Math.max(rect.y + shiftY, 0),
          Math.max(boxHeight - rect.height, 0),
        ),
      });
  }
};

/** Absolute centre -> the top-left React Flow stores, in the parent's frame. */
const toRelativePosition = (
  centre: Vec,
  width: number,
  height: number,
  parentTopLeft: Vec | null,
): Vec => {
  const topLeft = { x: centre.x - width / 2, y: centre.y - height / 2 };
  return parentTopLeft === null
    ? topLeft
    : { x: topLeft.x - parentTopLeft.x, y: topLeft.y - parentTopLeft.y };
};

/**
 * Moves the whole diagram into the positive quadrant.
 *
 * Only the absolute frame is shifted: child positions are expressed relative to
 * their parent, so translating them as well would move them twice.
 */
const translationFor = (
  graph: LayoutGraph,
  centres: Placement,
  params: LayoutParams,
): Vec => {
  const rects = [];
  for (const [id, centre] of centres) {
    const element = graph.elements.get(id);
    if (element === undefined) continue;
    rects.push(rectAt(id, centre, element.visualWidth, element.visualHeight));
  }
  if (rects.length === 0) return { x: 0, y: 0 };
  const box = boundingBox(rects);
  return { x: params.margin - box.x, y: params.margin - box.y };
};

export const layoutDiscreteSearch = (
  nodes: LayoutInputNode[],
  edges: LayoutInputEdge[],
  params: LayoutParams = DEFAULT_LAYOUT_PARAMS,
): LayoutPositions => {
  const positions: LayoutPositions = new Map();
  if (nodes.length === 0) return positions;

  const graph = buildLayoutGraph(nodes, edges, params);

  // steps 1-3: the skeleton, by discrete search
  // step 6: revisit the greedy decisions, without ever breaking an alignment
  const centres: Placement = new Map(
    refinePlacement(graph, placeSkeleton(graph, params), params),
  );
  // step 4: diamonds and triangles, relative to what they join
  for (const [id, centre] of placeConnectors(graph, centres, params))
    centres.set(id, centre);
  // step 5: attributes into the free sectors around their owner
  for (const [id, centre] of placeAttributes(graph, centres, params))
    centres.set(id, centre);

  // step 7: everything into the positive quadrant
  const translation = translationFor(graph, centres, params);
  const absoluteCentre = (id: string) => {
    const centre = centres.get(id);
    return centre === undefined
      ? undefined
      : { x: centre.x + translation.x, y: centre.y + translation.y };
  };

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const topLeftOf = (id: string): Vec | null => {
    const element = graph.elements.get(id);
    const centre = absoluteCentre(id);
    if (element === undefined || centre === undefined) return null;
    return {
      x: centre.x - element.width / 2,
      y: centre.y - element.height / 2,
    };
  };

  for (const node of nodes) {
    const element = graph.elements.get(node.id);
    const centre = absoluteCentre(node.id);

    // anything inside an aggregation keeps the position it already has: the box
    // is laid out as one opaque element and its contents travel with it
    if (
      element === undefined ||
      element.role === "frozen" ||
      centre === undefined
    ) {
      positions.set(node.id, { ...node.position });
      continue;
    }

    const parent = node.parentNode ? byId.get(node.parentNode) : undefined;
    const parentTopLeft = parent ? topLeftOf(parent.id) : null;

    positions.set(
      node.id,
      toRelativePosition(centre, element.width, element.height, parentTopLeft),
    );
  }

  layoutAggregationInteriors(nodes, edges, params, positions);

  return positions;
};

export { DEFAULT_LAYOUT_PARAMS } from "./params";
export type { LayoutParams } from "./params";
export type { LayoutInputEdge, LayoutInputNode } from "./buildLayoutGraph";
