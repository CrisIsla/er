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
import {
  Vec,
  capBurial,
  outlineExit,
  outlineHit,
} from "../../../util/nodeOutline";
import {
  EdgeAnchor,
  useDiagramSettings,
} from "../../../hooks/useDiagramSettings";

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
 * Which of the five handles along a side an edge is bound for, given as a
 * position across the line rather than as an id: -2 and +2 are the ends of the
 * side, 0 its middle.
 *
 * The order is the one the shapes lay their handles out in -- `1`, `2`, the
 * unnumbered one, `3`, `4`, running along the side (NodeHandles.tsx builds
 * them; DefaultEntity.tsx puts them at 2%, 25%, 50%, 75% and 98% of it, and
 * DefaultRelationship.tsx spreads the same five around half the diamond). Only
 * the edges of a participant with roles carry a number -- see
 * childParticipantToEdge in util/erToReactflowElements.ts -- so everything else
 * in the diagram is the middle, and stays exactly where it was.
 */
const HANDLE_SLOTS: Record<string, number> = {
  "1": -2,
  "2": -1,
  "3": 1,
  "4": 2,
};

export const handleSlot = (handlePrefix: string): number =>
  HANDLE_SLOTS[handlePrefix] ?? 0;

/**
 * How far apart an orthogonal route's roles start, as a fraction of the room
 * across the line.
 *
 * 0.48 is what the handles already use: DefaultEntity.tsx puts the outermost
 * pair at 2% and 98% of a side, which is 0.96 of the half-extent -- so slots -2
 * and +2 leave where the `side` anchor would have had them leave, and the roles
 * keep the same order under either setting.
 */
const ROLE_SPREAD = 0.48;

/**
 * How far the outermost role bows away from the straight line. Two roles come
 * out `2 * ROLE_BOW` apart at their widest, which is what makes them read as
 * two rather than as one line drawn twice.
 *
 * Flat, not a fraction of the line. The layout seats a recursive relationship
 * one separation from its entity, so these lines are usually short -- and a
 * short line needs *more* bow to read as two, not less. What has to stay
 * legible is the gap between the curves, and that is a number of pixels.
 *
 * Signed to match ROLE_SPREAD, so a role keeps its place in the order whether
 * the diagram is drawing straight lines or orthogonal ones.
 */
const ROLE_BOW = 26;

/**
 * How far this role's line bows out, as a signed distance across the straight
 * line. The outermost slots get the whole of it, the inner ones half.
 */
const roleBow = (slot: number) => -(slot / 2) * ROLE_BOW;

/**
 * How far this edge's line bows, for a route drawn the way the diagram is
 * currently set.
 *
 * Only where the ends would otherwise coincide, which is anchored at the
 * shapes' centres. The `side` anchor already spreads the roles across the five
 * handles a side, and bowing on top of that sends them sweeping out around the
 * shapes they join. An orthogonal route cannot bow at all, and separates its
 * roles at the ends instead -- see getErEdgeParams.
 */
const bowFor = (
  handlePrefix: string,
  edgeAnchor: EdgeAnchor,
  isOrthogonal: boolean,
) =>
  isOrthogonal || edgeAnchor !== "centre"
    ? 0
    : roleBow(handleSlot(handlePrefix));

/**
 * A quadratic through a point `bow` off the middle of the straight line.
 *
 * A Bezier sits half way to its control point at its widest, so the control
 * goes twice as far out as the line is meant to bow. Curving is what keeps
 * several edges between the same pair apart without moving where any of them
 * meets its shape: each leaves along its own tangent, so it parts from its
 * neighbour immediately and still arrives where a single line would have.
 */
const bowedPath = (from: Vec, to: Vec, bow: number) => {
  const angle = Math.atan2(to.y - from.y, to.x - from.x);
  const control = {
    x: (from.x + to.x) / 2 - Math.sin(angle) * 2 * bow,
    y: (from.y + to.y) / 2 + Math.cos(angle) * 2 * bow,
  };
  return {
    control,
    path: `M ${from.x},${from.y} Q ${control.x},${control.y} ${to.x},${to.y}`,
  };
};

/** Where a quadratic has got to at `t`, and which way it is going there. */
const alongBow = (from: Vec, control: Vec, to: Vec, t: number) => {
  const u = 1 - t;
  return {
    point: {
      x: u * u * from.x + 2 * u * t * control.x + t * t * to.x,
      y: u * u * from.y + 2 * u * t * control.y + t * t * to.y,
    },
    heading: Math.atan2(
      2 * (u * (control.y - from.y) + t * (to.y - control.y)),
      2 * (u * (control.x - from.x) + t * (to.x - control.x)),
    ),
  };
};

/**
 * How much room there is across the line for the roles to spread into: the
 * least either shape reaches to either side of it.
 *
 * Shared between the two ends, and symmetric in both arguments and in the two
 * directions, so each end works out the same offset and the line stays parallel
 * to the one it would have drawn. The smaller shape deciding is what keeps a
 * fan of roles on an aggregation box -- hundreds of pixels across -- pinned to
 * the width of the diamond it joins, instead of spreading over a side that the
 * line is nowhere near.
 *
 * Both directions are measured because they are not always the same distance:
 * an ISA triangle's apex reaches past its box on one side only.
 */
const roomAcross = (nodeA: Node, nodeB: Node, along: number) =>
  Math.min(
    outlineHit(nodeA, along + Math.PI / 2).distance,
    outlineHit(nodeA, along - Math.PI / 2).distance,
    outlineHit(nodeB, along + Math.PI / 2).distance,
    outlineHit(nodeB, along - Math.PI / 2).distance,
  );

/**
 * Where an aimed end of the edge lands: on `nodeA`'s outline, on the way to the
 * centre of `nodeB`.
 *
 * The two ends must not cross, or the line doubles back on itself when two
 * shapes overlap. What they may not do is *share the distance evenly*: an
 * aggregation container is hundreds of pixels across and the diamond it joins
 * is not, so giving each half would stop the line well inside the box -- across
 * the dashed border, hanging in the middle of the aggregation. So the room this
 * end may take is worked out against how far the other end reaches along the
 * same line.
 *
 * While the shapes are clear of each other the full outline distance fits and
 * the line meets the shape exactly. Only once they overlap do the two ends
 * share what there is, in proportion, meeting at a single point.
 *
 * `slot` is how an *orthogonal* route keeps several edges between the same pair
 * of shapes apart -- an entity that fills more than one role in a relationship.
 * Aiming at the centre is otherwise a question about the two centres alone, so
 * every one of those edges would be the same line drawn again, with the labels
 * stacked on top of each other. A straight route has a better answer, and bows
 * instead (roleBow), which leaves every role meeting its shape exactly where a
 * single line would have; axis-aligned legs cannot bow, so they are moved apart
 * here instead.
 *
 * The line is moved *across* rather than turned: both ends shift by the same
 * vector, so each still runs along its own ray and leaves its own shape.
 * Turning the ray instead would let the line between two turned rays cut back
 * through the shape it just left, which on a wide entity is a visible stub
 * drawn across the fill.
 */
export const aimedEnd = (
  nodeA: Node,
  nodeB: Node,
  centerA: Vec,
  centerB: Vec,
  slot: number = 0,
): [number, number, number] => {
  const angle = Math.atan2(centerB.y - centerA.y, centerB.x - centerA.x);
  const gap = Math.hypot(centerB.x - centerA.x, centerB.y - centerA.y);

  // Negated so that, with the diamond seated to the right of its entity -- the
  // first cardinal placeConnectors tries, and so the usual one -- the roles come
  // out in the order the `side` anchor draws them in: `1` at the top of the
  // side, `4` at the bottom. Which way round they are elsewhere follows the
  // line rather than the page, because the fan turns with it: the handles jump
  // between an order in y and an order in x as the side an edge leaves changes,
  // and there is nothing to be gained by reproducing that.
  const lateral =
    slot === 0 ? 0 : -slot * ROLE_SPREAD * roomAcross(nodeA, nodeB, angle);
  // across the line, and the same vector at both ends: the far end is called
  // with the bearing reversed *and* the slot negated, which cancel
  const from = {
    x: -Math.sin(angle) * lateral,
    y: Math.cos(angle) * lateral,
  };

  const hit = outlineExit(nodeA, from, angle);
  const other = outlineExit(nodeB, from, angle + Math.PI);

  const total = hit.distance + other.distance;
  const share = total > 0 ? (gap * hit.distance) / total : gap / 2;
  const reach = Math.min(hit.distance, share);

  return [
    centerA.x + from.x + reach * Math.cos(angle),
    centerA.y + from.y + reach * Math.sin(angle),
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
  slot: number = 0,
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
    const [x, y, facing] = aimedEnd(nodeA, nodeB, centerA, centerB, slot);
    return [x, y, position, facing];
  }

  /**
   * An aggregation is a container rather than a symbol, so its box is hundreds
   * of pixels across. A handle sits at a fixed point on its side -- the middle,
   * for an edge with no role -- and on a box that size the line can end up
   * attaching a couple of hundred pixels from where it is pointing, which reads
   * as an edge aimed at nothing. Meet the box where the line actually crosses
   * it instead.
   *
   * Role edges keep their handles: those are deliberately spread along a side
   * so that several edges between the same pair stay apart.
   */
  if (nodeA.type === "aggregation" && handlePrefix === "") {
    const angle = Math.atan2(centerB.y - centerA.y, centerB.x - centerA.x);
    const hit = outlineHit(nodeA, angle);
    // never past the other node's centre, so two overlapping boxes still give a
    // line that runs the right way
    const gap = Math.hypot(centerB.x - centerA.x, centerB.y - centerA.y);
    const reach = Math.min(hit.distance, gap);
    return [
      centerA.x + reach * Math.cos(angle),
      centerA.y + reach * Math.sin(angle),
      position,
      hit.normal,
    ];
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
  isOrthogonal: boolean = false,
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
  // Where several edges run between the same pair of shapes, a straight route
  // keeps them apart by bowing -- see roleBow -- which leaves every one of them
  // meeting its shape where a single line would have. An orthogonal route is
  // axis-aligned legs and cannot bow, so there, and only there, they are moved
  // apart at the ends instead.
  //
  // The far end is given the slot negated, because it also works from the
  // reversed bearing: the two cancel, and both ends move the same way across
  // the line rather than pivoting about its middle.
  const slot = isOrthogonal ? handleSlot(handlePrefix) : 0;

  const [sx, sy, sourcePos, sourceFacing] = getParams(
    source,
    target,
    handlePrefix,
    edgeAnchor,
    slot,
  );
  const [tx, ty, targetPos, targetFacing] = getParams(
    target,
    source,
    handlePrefix,
    edgeAnchor,
    -slot,
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

/**
 * The route between two points, in whichever style the diagram is set to.
 *
 * `bow` only applies to a straight route: an orthogonal one is axis-aligned
 * legs by definition, and there the roles are kept apart by where they start
 * instead.
 */
const routeBetween = (
  isOrthogonal: boolean,
  from: Vec,
  to: Vec,
  sourcePos: Position,
  targetPos: Position,
  bow: number = 0,
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
    : bow !== 0
    ? bowedPath(from, to, bow).path
    : getStraightPath({
        sourceX: from.x,
        sourceY: from.y,
        targetX: to.x,
        targetY: to.y,
      })[0];

/**
 * The points of a path built only of moves, lines and bends.
 *
 * Taking the last coordinate pair of each command is enough: `M` and `L` carry
 * one, and the `Q` that `getSmoothStepPath` emits at a corner carries the
 * control point first and the point it lands on second. Anything else means a
 * genuine curve, which has no polyline to report.
 */
const pointsOfPath = (path: string): Vec[] => {
  const points: Vec[] = [];

  for (const command of path.match(/[A-Za-z][^A-Za-z]*/g) ?? []) {
    if (!["M", "L", "Q"].includes(command[0])) return [];
    const numbers = (command.match(/-?\d+(?:\.\d+)?(?:e-?\d+)?/g) ?? []).map(
      Number,
    );
    if (numbers.length < 2) return [];
    points.push({
      x: numbers[numbers.length - 2],
      y: numbers[numbers.length - 1],
    });
  }

  return points;
};

/**
 * The route an edge is drawn along, as a polyline.
 *
 * Straight is the two ends, and needs no help. Orthogonal is four or five
 * axis-aligned legs, and the point list React Flow builds them from is private
 * -- so the path it returns is parsed back instead of the routing being
 * reimplemented here, which would leave two things to keep in step. The corners
 * come back doubled, because `routeBetween` asks for a zero radius and a bend
 * of no size still emits both the line into the corner and the curve across it.
 */
/** How many segments a bowed route is reported as. */
const BOW_SAMPLES = 12;

export const routePoints = (
  isOrthogonal: boolean,
  from: Vec,
  to: Vec,
  sourcePos: Position,
  targetPos: Position,
  bow: number = 0,
): Vec[] => {
  if (!isOrthogonal) {
    if (bow === 0) return [from, to];
    // a curve has no corners to read back, so it is walked instead -- the
    // polyline is what everything reasoning about the line, rather than drawing
    // it, works on
    const { control } = bowedPath(from, to, bow);
    return Array.from(
      { length: BOW_SAMPLES + 1 },
      (_, step) => alongBow(from, control, to, step / BOW_SAMPLES).point,
    );
  }

  const points = pointsOfPath(
    routeBetween(true, from, to, sourcePos, targetPos),
  );
  return points.filter(
    (point, index) =>
      index === 0 ||
      point.x !== points[index - 1].x ||
      point.y !== points[index - 1].y,
  );
};

/**
 * Where the edge between two nodes is actually drawn, for anything that needs
 * to reason about the line rather than render it.
 *
 * The endpoints have to come from here rather than be modelled, because the
 * default anchoring puts them on *handles*: on a wide entity the handle the
 * line leaves from can sit half a box away from where a centre-to-centre ray
 * would leave, and role edges deliberately spread across five handles a side,
 * so two lines the reader sees between the same pair would collapse into one
 * line drawn nowhere.
 *
 * Empty when the geometry cannot be trusted: a node React Flow has not measured
 * has no handle bounds, and `getHandleCoordsByPosition` answers a handle it
 * cannot find with the flow origin, which would put a phantom line across the
 * whole diagram.
 */
export const drawnRoute = (
  source: Node,
  target: Node,
  handlePrefix: string,
  edgeAnchor: EdgeAnchor,
  isOrthogonal: boolean,
): Vec[] => {
  if (!source.positionAbsolute || !target.positionAbsolute) return [];

  const { sx, sy, tx, ty, sourcePos, targetPos } = getErEdgeParams(
    source,
    target,
    handlePrefix,
    edgeAnchor,
    isOrthogonal,
  );

  if (![sx, sy, tx, ty].every(Number.isFinite)) return [];
  if ((sx === 0 && sy === 0) || (tx === 0 && ty === 0)) return [];

  return routePoints(
    isOrthogonal,
    { x: sx, y: sy },
    { x: tx, y: ty },
    sourcePos,
    targetPos,
    bowFor(handlePrefix, edgeAnchor, isOrthogonal),
  );
};

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
    getErEdgeParams(
      sourceNode,
      targetNode,
      handlePrefix,
      settings.edgeAnchor,
      isOrthogonal,
    );

  const angle = Math.atan2(ty - sy, tx - sx);
  const dist = Math.sqrt((tx - sx) ** 2 + (ty - sy) ** 2);
  const bow = bowFor(handlePrefix, settings.edgeAnchor, isOrthogonal);

  if (labelDist === undefined)
    labelDist = isOrthogonal ? dist / 2 : dist * 0.66;
  labelDist = Math.min(labelDist, dist * 0.9);

  // a label belongs on the line it names, so on a bowed one it is read off the
  // curve rather than off the straight line between the ends
  const { control } = bowedPath({ x: sx, y: sy }, { x: tx, y: ty }, bow);
  const at = (t: number) =>
    bow === 0
      ? {
          x: sx + t * dist * Math.cos(angle),
          y: sy + t * dist * Math.sin(angle),
        }
      : alongBow({ x: sx, y: sy }, control, { x: tx, y: ty }, t).point;

  const { x: labelX, y: labelY } = at(dist === 0 ? 0 : labelDist / dist);
  // a role's name goes where its own curve is furthest from its neighbour's,
  // which is the top of the bow. Unbowed there is no such point, and it keeps
  // the third of the way along that it has always had.
  const { x: roleLabelX, y: roleLabelY } = at(bow === 0 ? 0.3 : 0.5);

  if (shortenPathBy !== 0) {
    // along the way the line actually leaves, which on a bowed one is its
    // tangent rather than the straight bearing
    const leaving =
      bow === 0 ? angle : Math.atan2(control.y - sy, control.x - sx);
    sx = sx + shortenPathBy * Math.cos(leaving);
    sy = sy + shortenPathBy * Math.sin(leaving);
  }

  const edgePath = routeBetween(
    isOrthogonal,
    { x: sx, y: sy },
    { x: tx, y: ty },
    sourcePos,
    targetPos,
    bow,
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
          bow,
        );

  return [edgePath, labelX, labelY, roleLabelX, roleLabelY, strokePath];
};
