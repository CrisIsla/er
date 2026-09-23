/**
 * What the diagram is currently hiding from the reader.
 *
 * Splits the way `AttributeTooltip` does: this reads the geometry out of React
 * Flow, and `util/occlusion.ts` decides what any of it means. Everything React
 * Flow knows and a plain polygon does not -- which handle a line leaves from,
 * whether the route is stepped, which box a node was re-parented into -- is
 * resolved here, so the rule itself stays testable without a DOM.
 *
 * The edges are asked of the renderer rather than modelled, because the default
 * anchoring puts an endpoint on a handle rather than on the line between two
 * centres: see `drawnRoute`.
 */

import { useCallback, useMemo } from "react";
import { Node, ReactFlowState, useReactFlow, useStore } from "reactflow";
import { drawnRoute } from "../components/ErDiagram/notations/useEdgePath";
import { getHandlePrefix } from "../util/common";
import { buildContainerMap } from "../util/erGraph";
import { outlinePolygon } from "../util/nodeOutline";
import { Occlusion, Route, Shape, findOcclusions } from "../util/occlusion";
import { useDiagramSettings } from "./useDiagramSettings";

/**
 * Everything a mark depends on, as one string.
 *
 * `useStore` compares with `Object.is` and runs its selector on every write to
 * the store -- every frame of a drag, every measurement, every wheel event --
 * so this has to return a primitive. Returning the nodes themselves would
 * re-render forever, since React Flow rebuilds each node's internals object on
 * every pass.
 *
 * Positions are rounded to the pixel, which is the resolution a mark is drawn
 * at anyway. Nothing about selection, dragging or the viewport belongs here:
 * selecting a node changes how it stacks and moves nothing.
 */
const fingerprintOf = (state: ReactFlowState) => {
  const parts: string[] = [];

  for (const node of state.nodeInternals.values()) {
    const at = node.positionAbsolute ?? node.position;
    parts.push(
      [
        node.id,
        node.type,
        Math.round(at.x),
        Math.round(at.y),
        node.width,
        node.height,
        node.hidden ? 1 : 0,
      ].join(":"),
    );
  }

  for (const edge of state.edges)
    parts.push(
      [edge.id, edge.source, edge.target, edge.hidden ? 1 : 0].join(":"),
    );

  return parts.join("|");
};

/** Nodes React Flow has placed and measured, so there is a shape to speak of. */
const isDrawn = (node: Node) =>
  !node.hidden &&
  node.positionAbsolute !== undefined &&
  (node.width ?? 0) > 0 &&
  (node.height ?? 0) > 0;

export const useOcclusions = (isOrthogonal: boolean): Occlusion[] => {
  const { settings } = useDiagramSettings();
  const { getNodes, getEdges } = useReactFlow();
  const { highlightOcclusions, edgeAnchor } = settings;

  // with the setting off the selector costs one constant per store write
  // instead of a string the length of the diagram
  const fingerprint = useStore(
    useCallback(
      (state: ReactFlowState) =>
        highlightOcclusions ? fingerprintOf(state) : "",
      [highlightOcclusions],
    ),
  );

  return useMemo(() => {
    if (!highlightOcclusions || fingerprint === "") return [];

    const nodes = getNodes();
    // a node that is on its way to being measured has no shape yet, and marking
    // the seed positions it passes through on the way would be pure noise
    if (nodes.some((node) => !node.hidden && !isDrawn(node))) return [];

    const drawn = nodes.filter(isDrawn);
    const byId = new Map(drawn.map((node) => [node.id, node]));
    const containers = buildContainerMap(nodes);

    const shapes: Shape[] = drawn.map((node) => ({
      id: node.id,
      polygon: outlinePolygon(node, {
        x: node.positionAbsolute!.x + node.width! / 2,
        y: node.positionAbsolute!.y + node.height! / 2,
      }),
      // an aggregation's fill is see-through and it covers the edges between
      // its own members by design, so it hides no line
      occludesEdges: node.type !== "aggregation",
      containerIds: containers.get(node.id) ?? [],
    }));

    const routes: Route[] = [];
    for (const edge of getEdges()) {
      if (edge.hidden) continue;
      const source = byId.get(edge.source);
      const target = byId.get(edge.target);
      if (source === undefined || target === undefined) continue;

      const points = drawnRoute(
        source,
        target,
        getHandlePrefix(edge.id),
        edgeAnchor,
        isOrthogonal,
      );
      if (points.length < 2) continue;

      routes.push({
        id: edge.id,
        sourceId: edge.source,
        targetId: edge.target,
        points,
      });
    }

    return findOcclusions(shapes, routes);
    // `edgeAnchor` and `isOrthogonal` are not in the store, so nothing writes to
    // it when they change and the fingerprint alone would leave stale marks
  }, [
    fingerprint,
    highlightOcclusions,
    edgeAnchor,
    isOrthogonal,
    getNodes,
    getEdges,
  ]);
};

/** The nodes to frame when showing a mark: enough to see what the problem is. */
export const nodesOfOcclusion = (occlusion: Occlusion): { id: string }[] =>
  occlusion.kind === "shape"
    ? occlusion.between.map((id) => ({ id }))
    : [occlusion.shapeId, occlusion.sourceId, occlusion.targetId].map((id) => ({
        id,
      }));
