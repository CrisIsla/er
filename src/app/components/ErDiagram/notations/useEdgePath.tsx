import { useCallback } from "react";
import {
  HandleElement,
  Node,
  Position,
  getSmoothStepPath,
  getStraightPath,
  internalsSymbol,
  useStore,
} from "reactflow";
import { isAttributeNode } from "../../../util/erGraph";
import { capBurial, outlineHit } from "../../../util/nodeOutline";
import {
  EdgeAnchor,
  useDiagramSettings,
} from "../../../hooks/useDiagramSettings";

type Vec = { x: number; y: number };

/**
 * Whether this end of the edge is aimed at the node's centre rather than at a
 * handle. It still stops on the shape's outline -- see aimedEnd() -- so the line
 * meets the shape at the angle it travels instead of hooking onto one of the
 * four handle positions.
 *
 * Attributes always are: they are ellipses, so a handle can only ever sit on one
 * of the four cardinal points of the outline. Everything else follows the
 * setting.
 */
const aimsAtCentre = (node: Node, edgeAnchor: EdgeAnchor) =>
  isAttributeNode(node) || edgeAnchor === "centre";

/**
 * Where an aimed end of the edge lands: on `nodeA`'s outline, on the way to the
 * centre of `nodeB`.
 *
 * Never reaches past the halfway point, so two overlapping shapes give a short
 * line rather than one that doubles back on itself.
 */
const aimedEnd = (
  nodeA: Node,
  centerA: Vec,
  centerB: Vec,
): [number, number, number] => {
  const angle = Math.atan2(centerB.y - centerA.y, centerB.x - centerA.x);
  const gap = Math.hypot(centerB.x - centerA.x, centerB.y - centerA.y);
  const hit = outlineHit(nodeA, angle);
  const reach = Math.min(hit.distance, gap / 2);
  return [
    centerA.x + reach * Math.cos(angle),
    centerA.y + reach * Math.sin(angle),
    hit.normal,
  ];
};

/** Which way a node's outline faces at each of the four handle sides. */
const SIDE_NORMALS: Record<Position, number> = {
  [Position.Right]: 0,
  [Position.Bottom]: Math.PI / 2,
  [Position.Left]: Math.PI,
  [Position.Top]: -Math.PI / 2,
};

const getParams = (
  nodeA: Node,
  nodeB: Node,
  handlePrefix: string,
  edgeAnchor: EdgeAnchor,
): [number, number, Position, number] => {
  const centerA = getNodeCenter(nodeA);
  const centerB = getNodeCenter(nodeB);

  const horizontalDiff = Math.abs(centerA.x - centerB.x);
  const verticalDiff = Math.abs(centerA.y - centerB.y);

  // Which side the centre-to-centre ray leaves through is not decided by the
  // bigger difference but by how far the box reaches in each direction: on a
  // 600x40 entity something 200px to the right and 150px below is still below
  // it, and taking Position.Right there would anchor the edge 100px past the
  // node it is heading for. So compare the differences against the half-extents
  // -- the same reasoning as supportRadius() in util/layout/connectors.ts.
  //
  // |dx| / halfWidth > |dy| / halfHeight, cross-multiplied so a node that has
  // not been measured yet (no width or height) keeps falling into the vertical
  // branch as it did before, instead of dividing by zero.
  const halfWidth = (nodeA.width ?? 0) / 2;
  const halfHeight = (nodeA.height ?? 0) / 2;

  let position;

  if (horizontalDiff * halfHeight > verticalDiff * halfWidth) {
    position = centerA.x > centerB.x ? Position.Left : Position.Right;
  } else {
    position = centerA.y > centerB.y ? Position.Top : Position.Bottom;
  }

  // the side is still worked out above, since the orthogonal routing needs to
  // know which way the line leaves even when the end is an aimed one
  if (aimsAtCentre(nodeA, edgeAnchor)) {
    const [x, y, facing] = aimedEnd(nodeA, centerA, centerB);
    return [x, y, position, facing];
  }

  const [x, y] = getHandleCoordsByPosition(nodeA, position, handlePrefix);
  // a handle sits on the side it is named after, so that side is what the edge
  // arrives at
  return [x, y, position, SIDE_NORMALS[position]];
};

const getHandleCoordsByPosition = (
  node: Node,
  handlePosition: Position,
  handlePrefix: string,
): number[] => {
  let handleMatchCondition = (h: HandleElement) =>
    h.position === handlePosition;
  if (handlePrefix !== "") {
    handleMatchCondition = (h: HandleElement) =>
      h.position === handlePosition && h.id![0] === handlePrefix;
  }

  let handle = node[internalsSymbol]?.handleBounds?.source?.find((h) =>
    handleMatchCondition(h),
  );
  if (handle === undefined)
    handle = node[internalsSymbol]?.handleBounds?.target?.find((h) =>
      handleMatchCondition(h),
    );

  if (handle === undefined) {
    // FIXME!: See issue #1, sometimes the 5 handles per side are not created when they should be
    // this hack doesn't cause edges to be routed differently, weird.
    return [0, 0];
  }

  const offsetX = handle!.width / 2;
  const offsetY = handle!.height / 2;

  const x = node.positionAbsolute!.x + handle!.x + offsetX;
  const y = node.positionAbsolute!.y + handle!.y + offsetY;

  return [x, y];
};

const getNodeCenter = (node: Node): Vec => {
  return {
    x: node.positionAbsolute!.x + node.width! / 2,
    y: node.positionAbsolute!.y + node.height! / 2,
  };
};

// returns the parameters (sx, sy, tx, ty, sourcePos, targetPos) you need to create an edge
const getErEdgeParams = (
  source: Node,
  target: Node,
  handlePrefix: string,
  edgeAnchor: EdgeAnchor,
): {
  sx: number;
  sy: number;
  tx: number;
  ty: number;
  sourcePos: Position;
  targetPos: Position;
  sourceFacing: number;
  targetFacing: number;
} => {
  const [sx, sy, sourcePos, sourceFacing] = getParams(
    source,
    target,
    handlePrefix,
    edgeAnchor,
  );
  const [tx, ty, targetPos, targetFacing] = getParams(
    target,
    source,
    handlePrefix,
    edgeAnchor,
  );

  return {
    sx,
    sy,
    tx,
    ty,
    sourcePos,
    targetPos,
    sourceFacing,
    targetFacing,
  };
};

/** The route between two points, in whichever style the diagram is set to. */
const routeBetween = (
  isOrthogonal: boolean,
  from: Vec,
  to: Vec,
  sourcePos: Position,
  targetPos: Position,
) =>
  isOrthogonal
    ? getSmoothStepPath({
        sourceX: from.x,
        sourceY: from.y,
        targetX: to.x,
        targetY: to.y,
        borderRadius: 0,
        sourcePosition: sourcePos,
        targetPosition: targetPos,
      })[0]
    : getStraightPath({
        sourceX: from.x,
        sourceY: from.y,
        targetX: to.x,
        targetY: to.y,
      })[0];

export const useEdgePath = (
  sourceNodeId: string,
  targetNodeId: string,
  isOrthogonal: boolean,
  shortenPathBy: number = 0,
  handlePrefix: string = "",
  labelDist: number | undefined = undefined,
):
  | [string, number, number, number, number, (strokeWidth: number) => string]
  | [null, null, null, null, null, null] => {
  const sourceNode = useStore(
    useCallback(
      (store) => store.nodeInternals.get(sourceNodeId),
      [sourceNodeId],
    ),
  );
  const targetNode = useStore(
    useCallback(
      (store) => store.nodeInternals.get(targetNodeId),
      [targetNodeId],
    ),
  );
  const { settings } = useDiagramSettings();

  if (!sourceNode || !targetNode) {
    return [null, null, null, null, null, null];
  }

  // we mix const and let assigments, eslint will complain in both cases
  let { sx, sy, tx, ty, sourcePos, targetPos, sourceFacing, targetFacing } =
    getErEdgeParams(sourceNode, targetNode, handlePrefix, settings.edgeAnchor);

  const angle = Math.atan2(ty - sy, tx - sx);
  const dist = Math.sqrt((tx - sx) ** 2 + (ty - sy) ** 2);
  if (labelDist === undefined)
    labelDist = isOrthogonal ? dist / 2 : dist * 0.66;
  labelDist = Math.min(labelDist, dist * 0.9);

  const labelX = sx + labelDist * Math.cos(angle);
  const labelY = sy + labelDist * Math.sin(angle);

  const roleDist = dist * 0.3;
  const roleLabelX = sx + roleDist * Math.cos(angle);
  const roleLabelY = sy + roleDist * Math.sin(angle);

  if (shortenPathBy !== 0) {
    // we need to shorten the path so the arrowhead looks good
    sx = sx + shortenPathBy * Math.cos(angle);
    sy = sy + shortenPathBy * Math.sin(angle);
  }

  const edgePath = routeBetween(
    isOrthogonal,
    { x: sx, y: sy },
    { x: tx, y: ty },
    sourcePos,
    targetPos,
  );

  // A stroke is a band, and SVG ends it square to the line it follows rather
  // than square to the shape it arrives at. Meeting a shape at an angle, one
  // rail of the band stops short of the outline and hangs in the open. Each
  // stroke therefore gets its own path, run far enough past the endpoint for its
  // own cap to be buried in the shape -- the wider the stroke, the further.
  // Markers stay on the plain path, so they are still drawn on the outline.
  const buriedEnd = (
    x: number,
    y: number,
    leaving: number,
    facing: number,
    strokeWidth: number,
  ) => {
    const burial = capBurial(strokeWidth, leaving, facing);
    return {
      x: x - burial * Math.cos(leaving),
      y: y - burial * Math.sin(leaving),
    };
  };

  // an orthogonal route leaves along the side it was given, whatever direction
  // the two nodes lie in
  const sourceLeaving = isOrthogonal ? SIDE_NORMALS[sourcePos] : angle;
  const targetLeaving = isOrthogonal
    ? SIDE_NORMALS[targetPos]
    : angle + Math.PI;

  const strokePath = (strokeWidth: number) =>
    strokeWidth <= 1
      ? edgePath
      : routeBetween(
          isOrthogonal,
          buriedEnd(sx, sy, sourceLeaving, sourceFacing, strokeWidth),
          buriedEnd(tx, ty, targetLeaving, targetFacing, strokeWidth),
          sourcePos,
          targetPos,
        );

  return [edgePath, labelX, labelY, roleLabelX, roleLabelY, strokePath];
};
