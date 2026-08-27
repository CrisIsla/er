/**
 * The geometry of an aggregation container: how big it should be, how small it
 * may be dragged, and where its contents go when it is resized.
 *
 * One padding rule serves all three, expressed once here:
 *
 *   size = the far edge of the visible members' visual rectangles + padding
 *
 * The layout arranges the contents so their near edge sits at `padding` and
 * then derives the box from the result; a manual resize is held to the same
 * rule applied to wherever the members currently are. So immediately after a
 * layout run the derived size *equals* the minimum, which is what lets a
 * user-chosen size and a layout-chosen size share one field with no flag
 * distinguishing them.
 *
 * Pure, and free of React Flow types, so both the layout and the node
 * component can use it and both can be unit tested without a DOM.
 */

import { PositionedNode, Rect } from "../alignmentCandidates";
import {
  DEFAULT_AGGREGATION_SIZE,
  MIN_AGGREGATION_SIZE,
  NodeSize,
  StyledNode,
  readNodeSize,
} from "../nodeSize";
import { DEFAULT_SIZES, measure } from "./buildLayoutGraph";
import { visualRectOf } from "./geometry";
import { boundingBox } from "./metrics";
import { DEFAULT_LAYOUT_PARAMS } from "./params";
import { Vec } from "./types";

const defaultPadding = DEFAULT_LAYOUT_PARAMS.aggregationPadding;

/**
 * The nodes a container holds directly.
 *
 * Direct children only, never `findAggregatedNodeIds`, which is transitive: a
 * nested container's own members have positions relative to the *inner* box, so
 * moving them with the outer box's numbers would move them twice. A nested
 * container that is a direct child scales like any other member, and its
 * contents travel with it for free.
 */
export const membersOf = (
  nodes: PositionedNode[],
  containerId: string,
): PositionedNode[] => nodes.filter((node) => node.parentNode === containerId);

/**
 * What a container's members cover, in the container's own frame.
 *
 * Visual rather than measured sizes: an aggregation always contains a
 * relationship diamond, which measures 95 and covers ~134 once `rotate-45` is
 * applied, so sizing a box from measured widths leaves the rotated corners
 * hanging over the dashed border.
 *
 * Hidden members take up no room, the same call `haloOf` makes in
 * buildLayoutGraph.ts: hiding attributes is a request for a diagram without
 * them, so reserving their space anyway would inflate every box in the diagram
 * around gaps nobody can see.
 */
export const memberRects = (
  members: PositionedNode[],
  positionOf?: (node: PositionedNode) => Vec,
  sizeOf: (node: PositionedNode) => NodeSize = measure,
): Rect[] =>
  members
    .filter((member) => member.hidden !== true)
    .map((member) => {
      const { width, height } = sizeOf(member);
      const position = positionOf?.(member) ?? member.position;
      return visualRectOf(
        member.id,
        member.type ?? "",
        position,
        width,
        height,
      );
    });

/** The padding rule. `rects` are in the container's frame. */
export const boxForContents = (
  rects: Rect[],
  padding: number = defaultPadding,
): NodeSize => {
  if (rects.length === 0) return { ...DEFAULT_AGGREGATION_SIZE };
  const box = boundingBox(rects);
  return {
    width: Math.ceil(box.x + box.width + padding),
    height: Math.ceil(box.y + box.height + padding),
  };
};

/**
 * The smallest box that still holds this container's current contents.
 *
 * Never smaller than `MIN_AGGREGATION_SIZE`, so a container that is empty or
 * not yet measured is still grabbable. Unmeasured members fall back through
 * `measure`'s per-type defaults rather than the DOM, so this is safe to call
 * before React Flow has measured anything.
 */
export const minimumAggregationSize = (
  nodes: PositionedNode[],
  containerId: string,
  padding: number = defaultPadding,
  sizeOf: (node: PositionedNode) => NodeSize = measure,
): NodeSize => {
  const rects = memberRects(membersOf(nodes, containerId), undefined, sizeOf);
  if (rects.length === 0) return { ...MIN_AGGREGATION_SIZE };
  const box = boxForContents(rects, padding);
  return {
    width: Math.max(box.width, MIN_AGGREGATION_SIZE.width),
    height: Math.max(box.height, MIN_AGGREGATION_SIZE.height),
  };
};

const clamp = (value: number, low: number, high: number) =>
  Math.min(Math.max(value, low), high);

/** A member as the resize transform sees it: measured box, container frame. */
export type MemberRect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/**
 * Everything the transform needs, captured when the drag starts.
 *
 * Deliberately holds no container *position*: when a top or left handle is
 * dragged the resizer moves the container itself, and React Flow re-derives
 * every member's absolute position from the parent chain. Members must not be
 * compensated for that as well, and a snapshot that cannot see the container's
 * position cannot accidentally do so.
 */
export type ResizeSnapshot = {
  width: number;
  height: number;
  padding: number;
  members: MemberRect[];
};

export const resizeSnapshot = (
  nodes: PositionedNode[],
  containerId: string,
  box: NodeSize,
  padding: number = defaultPadding,
): ResizeSnapshot => ({
  width: box.width,
  height: box.height,
  padding,
  // hidden members are included: one that kept its old position while
  // everything around it moved would pop into the wrong place -- or outside the
  // box -- the moment its owner is hovered and it is revealed
  members: membersOf(nodes, containerId).map((member) => {
    const { width, height } = measure(member);
    return {
      id: member.id,
      x: member.position.x,
      y: member.position.y,
      width,
      height,
    };
  }),
});

/**
 * Where a member sits on one axis after the box changes size.
 *
 * The fraction is taken over the member's *travel range* rather than over the
 * box, which is what makes this the "keep it 40% across" the feature asks for:
 * a member's centre may occupy `[padding + size/2, box - padding - size/2]`,
 * and `f` is its position in that interval. Scaling the coordinate itself
 * (`x * next / start`) would push a member's body out of the box, because the
 * member's own size does not scale with the container.
 *
 * Containment is therefore a property of the formula, not a clamp applied
 * afterwards -- which matters, because position changes applied through
 * `applyNodeChanges` bypass React Flow's `extent: "parent"` enforcement.
 */
export const scaleAlong = (
  start: number,
  size: number,
  boxStart: number,
  boxNext: number,
  padding: number,
): number => {
  // exact, so an unchanged axis and a drag that returns to where it began
  // reproduce the original coordinates bit for bit rather than nearly
  if (boxNext === boxStart) return start;

  const free0 = boxStart - 2 * padding - size;
  const free1 = boxNext - 2 * padding - size;

  // the member cannot fit between the padding lines: centre it, so it overflows
  // symmetrically instead of hanging off one side
  if (free1 <= 0) return (boxNext - size) / 2;
  // it did not fit before either, so there is no fraction to preserve
  if (free0 <= 0) return padding + free1 / 2;

  return padding + clamp((start - padding) / free0, 0, 1) * free1;
};

/**
 * Every member's new position, as a pure function of the drag-start snapshot.
 *
 * Never of the previous tick, and never of the store: recomputing from the
 * snapshot means no amount of dropped, coalesced or replayed ticks can
 * accumulate drift, and a drag that wanders and comes back leaves the contents
 * exactly where they started.
 */
export const scaleMembers = (
  snapshot: ResizeSnapshot,
  next: NodeSize,
): { id: string; position: Vec }[] =>
  snapshot.members.map((member) => ({
    id: member.id,
    position: {
      x: scaleAlong(
        member.x,
        member.width,
        snapshot.width,
        next.width,
        snapshot.padding,
      ),
      y: scaleAlong(
        member.y,
        member.height,
        snapshot.height,
        next.height,
        snapshot.padding,
      ),
    },
  }));

/**
 * The smallest box a resize drag may produce.
 *
 * NOT the contents' bounding box: the transform above keeps a member that was
 * flush against the padding line flush against it, so the contents always fill
 * whatever box they are in and a bounding-box floor would equal the current
 * size -- the handles would refuse to move inward at all.
 *
 * The real question is when the contents would start to *touch*. Each member
 * moves along `x(B) = f*B + c` with `f` its fraction of the travel range, so
 * for a pair that is separated now and closing as the box shrinks, the size at
 * which they meet is one division. `f` is invariant under the transform, so
 * this floor is a fixed property of an arrangement: shrinking to the stop and
 * grabbing the handle again gives the same stop, with no slow ratchet inward.
 *
 * Pairs that do not overlap on the other axis are skipped -- they pass each
 * other rather than collide. That is judged at the box the drag started from,
 * which is why this takes a snapshot rather than a live node list.
 */
export const resizeFloor = (snapshot: ResizeSnapshot): NodeSize => {
  const axis = (
    start: (m: MemberRect) => number,
    size: (m: MemberRect) => number,
    cross: (m: MemberRect) => number,
    crossSize: (m: MemberRect) => number,
    box: number,
  ) => {
    const { padding, members } = snapshot;
    if (members.length === 0) return 0;

    // every member has to keep fitting between the padding lines
    let floor = 2 * padding + Math.max(...members.map(size));

    const fractionOf = (m: MemberRect) => {
      const free = box - 2 * padding - size(m);
      return free > 0 ? clamp((start(m) - padding) / free, 0, 1) : 0.5;
    };
    // x(B) = f*B + offset
    const offsetOf = (m: MemberRect) =>
      padding - fractionOf(m) * (2 * padding + size(m));

    for (const a of members)
      for (const b of members) {
        if (a === b) continue;
        // a sits before b, and they share the other axis, so they can meet
        if (start(a) + size(a) > start(b)) continue;
        if (
          cross(a) + crossSize(a) <= cross(b) ||
          cross(b) + crossSize(b) <= cross(a)
        )
          continue;
        // ...but only if b is receding faster than a as the box shrinks
        const closing = fractionOf(b) - fractionOf(a);
        if (closing <= 0) continue;
        floor = Math.max(
          floor,
          (size(a) + offsetOf(a) - offsetOf(b)) / closing,
        );
      }

    return Math.ceil(floor);
  };

  return {
    width: axis(
      (m) => m.x,
      (m) => m.width,
      (m) => m.y,
      (m) => m.height,
      snapshot.width,
    ),
    height: axis(
      (m) => m.y,
      (m) => m.height,
      (m) => m.x,
      (m) => m.width,
      snapshot.height,
    ),
  };
};

/**
 * A member's size without asking the DOM for it.
 *
 * React Flow carries a node's measured size forward **by id**, and this app's
 * ids are array indices that shift whenever the document changes -- so for the
 * frame after a rebuild a node can be wearing the dimensions of whatever used
 * to hold its id. Anything that runs at that moment has to size members from
 * what it knows rather than from what was measured.
 *
 * An authored size is trusted: a nested container carries its own box, and that
 * value is carried across a rebuild by identity rather than by id. Everything
 * else falls back to its type's minimum, which under-reports a long label --
 * the safe direction, since the result is only ever used to grow a box.
 */
export const nominalSize = (node: PositionedNode & StyledNode): NodeSize =>
  readNodeSize(node) ?? DEFAULT_SIZES[node.type ?? ""] ?? DEFAULT_SIZES.entity;

/** How many aggregation containers a node sits inside. */
const aggregationDepth = (
  node: PositionedNode,
  byId: Map<string, PositionedNode>,
): number => {
  let depth = 0;
  let parentId = node.parentNode;
  const seen = new Set<string>([node.id]);
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = byId.get(parentId);
    if (parent === undefined) break;
    if (parent.type === "aggregation") depth += 1;
    parentId = parent.parentNode;
  }
  return depth;
};

/**
 * The size every container has to grow to in order to hold what is inside it.
 *
 * Only containers that need to change appear in the result, so a caller can
 * skip the write entirely when nothing moved -- which is also what stops this
 * from feeding itself.
 *
 * Grows only. A box the user made larger than its contents need is left alone;
 * shrinking it back is the layout button's job, not this one's.
 */
export const growAggregationsToFit = <T extends PositionedNode & StyledNode>(
  nodes: T[],
  padding: number = defaultPadding,
): Map<string, NodeSize> => {
  const byId = new Map<string, PositionedNode>(
    nodes.map((node) => [node.id, node]),
  );
  const containers = nodes
    .filter((node) => node.type === "aggregation")
    .sort(
      (a, b) =>
        aggregationDepth(b, byId) - aggregationDepth(a, byId) ||
        a.id.localeCompare(b.id),
    );

  // a working copy, so an inner box that grew is seen at its new size by the
  // box around it
  const working = nodes.map((node) => ({ ...node }));
  const workingById = new Map(working.map((node) => [node.id, node]));
  const grown = new Map<string, NodeSize>();

  for (const container of containers) {
    const node = workingById.get(container.id)!;
    const current = readNodeSize(node) ?? DEFAULT_AGGREGATION_SIZE;
    const needed = minimumAggregationSize(
      working,
      container.id,
      padding,
      nominalSize,
    );
    const next = {
      width: Math.max(current.width, needed.width),
      height: Math.max(current.height, needed.height),
    };
    if (next.width === current.width && next.height === current.height)
      continue;

    grown.set(container.id, next);
    node.width = next.width;
    node.height = next.height;
    node.style = { ...node.style, ...next };
  }

  return grown;
};
