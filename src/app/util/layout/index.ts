/**
 * The discrete-search layout, end to end.
 *
 * Runs the phases of the proposal's Algorithm 1 in order, then converts the
 * absolute centres the algorithm works in into the top-left, parent-relative
 * positions React Flow expects.
 *
 * `result.positions` is **total over the input ids**: every node gets a
 * position, including hidden attributes, the contents of aggregations and
 * anything the algorithm chose not to move. A missing entry would become
 * `translate(NaN, NaN)` and take the canvas down with it.
 *
 * `result.sizes` is keyed by aggregation container id only -- an aggregation's
 * box is derived from the contents the layout just arranged. A container with
 * no members gets no entry, and its caller must leave the size it already has
 * alone.
 */

import { NodeSize } from "../nodeSize";
import { boxForContents, memberRects } from "./aggregationBox";
import { placeAttributes } from "./attributes";
import {
  LayoutInputEdge,
  LayoutInputNode,
  buildLayoutGraph,
  measure,
} from "./buildLayoutGraph";
import { placeConnectors } from "./connectors";
import { rectAt } from "./geometry";
import { boundingBox } from "./metrics";
import { DEFAULT_LAYOUT_PARAMS, LayoutParams } from "./params";
import { placeSkeleton } from "./placement";
import { refinePlacement } from "./refine";
import { LayoutGraph, Placement, Vec } from "./types";

export type LayoutPositions = Map<string, Vec>;

/** Derived box per aggregation container. Containers with no members get no entry. */
export type LayoutSizes = Map<string, NodeSize>;

export type LayoutResult = { positions: LayoutPositions; sizes: LayoutSizes };

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
  // the sub-layout's own positive-quadrant margin. It has no effect on the
  // result any more -- the interior is re-shifted to `aggregationPadding`
  // afterwards -- but it keeps the sub-diagram off the axes while it is built.
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
 * Arranges the contents of every aggregation and cuts its box to fit them.
 *
 * erToReactflowElements drops every member at {0, 0} when it builds the box
 * (erToReactflowElements.ts:374) -- the pile-up in the corner the proposal
 * records as figure 10(b) -- so leaving the contents alone is not an option.
 * The search is simply run again on the member sub-diagram: members are children
 * of the container, so the coordinates it produces are already in the frame
 * React Flow wants. They are then shifted so their near edge sits one padding
 * inside the box, and the box is derived from where they ended up.
 *
 * Deriving rather than fitting-into is what removes the old failure mode: the
 * contents used to be squeezed into a fixed 500x500 and clamped, which turned
 * anything larger into overlapping stacks along the edges.
 *
 * Returns the input list with each container's derived size substituted in, so
 * the skeleton pass that follows reserves the room the container really needs.
 */
const layoutAggregationInteriors = (
  nodes: LayoutInputNode[],
  edges: LayoutInputEdge[],
  params: LayoutParams,
  positions: LayoutPositions,
): { nodes: LayoutInputNode[]; sizes: LayoutSizes } => {
  // every read of a node goes through this, so a container finished earlier in
  // the loop is seen at its derived size by the box that contains it
  const resolved = new Map(nodes.map((node) => [node.id, node]));
  const sizes: LayoutSizes = new Map();

  const members = new Map<string, string[]>();
  for (const node of nodes) {
    const container = nearestAggregationAncestor(node, resolved);
    if (container === null) continue;
    members.set(container.id, [...(members.get(container.id) ?? []), node.id]);
  }

  // deepest first, so a nested container is already arranged and sized before
  // the box around it is asked to hold it
  const containers = [...members.keys()]
    .map((id) => resolved.get(id)!)
    .sort(
      (a, b) =>
        depthOf(b, resolved) - depthOf(a, resolved) || a.id.localeCompare(b.id),
    );

  const padding = params.aggregationPadding;

  for (const container of containers) {
    const inside = members.get(container.id)!.map((id) => resolved.get(id)!);
    const insideIds = new Set(inside.map((node) => node.id));
    const insideEdges = edges.filter(
      (edge) => insideIds.has(edge.source) && insideIds.has(edge.target),
    );

    // the sub-layout knows nothing about the box: it arranges freely and the
    // box is cut to the result. (Its own members have no aggregation ancestor
    // inside this call, so the recursion bottoms out immediately.)
    const { positions: local } = layoutDiscreteSearch(
      inside,
      insideEdges,
      interiorParams(params),
    );
    const arranged = (node: LayoutInputNode) =>
      local.get(node.id) ?? node.position;

    // move the arrangement so its near edge sits one padding inside the box
    const box = boundingBox(memberRects(inside, arranged));
    const placed = new Map<string, Vec>(
      inside.map((node) => {
        const position = arranged(node);
        return [
          node.id,
          {
            x: Math.round(position.x + padding - box.x),
            y: Math.round(position.y + padding - box.y),
          },
        ];
      }),
    );

    // derived from the final, rounded rectangles rather than algebraically from
    // `box`, so the size a layout produces is exactly the minimum a manual
    // resize is later held to
    const size = boxForContents(
      memberRects(inside, (node) => placed.get(node.id)!),
      padding,
    );

    for (const node of inside) {
      const position = placed.get(node.id)!;
      const { width, height } = measure(node);
      // never binds for a visible member -- the shift above already put them
      // inside -- but hidden members took no part in sizing the box, and
      // React Flow clamps `extent: "parent"` children on drag, so anything left
      // outside would teleport the first time the user touched it
      positions.set(node.id, {
        x: Math.min(Math.max(position.x, 0), Math.max(size.width - width, 0)),
        y: Math.min(Math.max(position.y, 0), Math.max(size.height - height, 0)),
      });
    }

    sizes.set(container.id, size);
    resolved.set(container.id, { ...container, ...size });
  }

  return { nodes: nodes.map((node) => resolved.get(node.id)!), sizes };
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
): LayoutResult => {
  const positions: LayoutPositions = new Map();
  if (nodes.length === 0) return { positions, sizes: new Map() };

  // step 0: arrange each aggregation's contents and cut its box to fit. This
  // runs first because the skeleton pass has to reserve the container's real
  // footprint -- placing a box that derives to 700 as if it were 500 would
  // overlap its neighbours and under-shift the diagram in step 7.
  const { nodes: sized, sizes } = layoutAggregationInteriors(
    nodes,
    edges,
    params,
    positions,
  );

  const graph = buildLayoutGraph(sized, edges, params);

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

  const byId = new Map(sized.map((node) => [node.id, node]));
  const topLeftOf = (id: string): Vec | null => {
    const element = graph.elements.get(id);
    const centre = absoluteCentre(id);
    if (element === undefined || centre === undefined) return null;
    return {
      x: centre.x - element.width / 2,
      y: centre.y - element.height / 2,
    };
  };

  for (const node of sized) {
    const element = graph.elements.get(node.id);
    const centre = absoluteCentre(node.id);

    // anything inside an aggregation was placed in step 0, in its container's
    // own frame; the box is laid out as one opaque element and its contents
    // travel with it
    if (
      element === undefined ||
      element.role === "frozen" ||
      centre === undefined
    ) {
      if (!positions.has(node.id)) positions.set(node.id, { ...node.position });
      continue;
    }

    const parent = node.parentNode ? byId.get(node.parentNode) : undefined;
    const parentTopLeft = parent ? topLeftOf(parent.id) : null;

    positions.set(
      node.id,
      toRelativePosition(centre, element.width, element.height, parentTopLeft),
    );
  }

  return { positions, sizes };
};

export { DEFAULT_LAYOUT_PARAMS } from "./params";
export type { LayoutParams } from "./params";
export type { LayoutInputEdge, LayoutInputNode } from "./buildLayoutGraph";
