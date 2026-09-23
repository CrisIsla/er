/**
 * Where the diagram hides itself.
 *
 * Not every crossing is a defect. An ER graph is usually not planar, so lines
 * have to cross somewhere, and a crossing is legible -- you can see one line
 * pass over another and follow both. What is not legible is *occlusion*: a
 * shape parked on top of another so one of the two labels is gone, or a line
 * that runs under a box and reappears on the far side. React Flow paints every
 * edge in a layer beneath the nodes and every ER shape but the aggregation box
 * is opaque, so the second of those is guaranteed rather than unlucky.
 *
 * So this reports those two, and deliberately says nothing about edges crossing
 * each other -- the placement search already prices those, and marking the ones
 * it could not remove would bury the findings that matter under the ones the
 * user can do nothing about.
 *
 * Shapes arrive as convex polygons rather than as rectangles, and edges as the
 * polylines they are actually drawn along, because both distinctions change the
 * answer: see `outlinePolygon` for the shapes, and `useOcclusions` for the
 * edges. Pure and free of React Flow types, so the whole rule tests without a
 * DOM.
 *
 * Known gap, and a deliberate one: cardinality and role labels are drawn in the
 * edge-label portal over everything else, so a label sitting on a shape is an
 * occlusion the reader will see and this will not report. Labels are not part
 * of the geometry anything else in the diagram reasons about, and pulling them
 * in would mean measuring rendered text.
 */

import { rectsOverlap } from "./layout/geometry";
import { Vec, polygonBounds } from "./nodeOutline";

/** Guard for a denominator, not a tolerance. Matches nodeOutline.ts. */
const PARALLEL_EPSILON = 1e-9;

/**
 * How close two clipped vertices have to be to count as one.
 *
 * Coordinates are canvas pixels in the low thousands, where double precision is
 * good to about 1e-13, so this sits nine orders above the noise and twelve
 * below anything visible. It exists only because an inclusive inside test emits
 * both a kept vertex and an intersection point when the two coincide.
 */
const VERTEX_EPSILON = 1e-6;

/**
 * How deep two shapes must be into each other before it is worth saying so.
 *
 * Measured as the narrowest width of the shared region, not its area: two
 * 600px-wide entities grazing each other by half a pixel share 300 square
 * pixels, which is a lot of area and nothing a reader could see. Dragging with
 * collision on parks shapes at exact tangency by design, and
 * `slideOutOfCollisions` is tested on touching not counting as overlapping, so
 * anything at or below half a pixel is that rule landing correctly.
 */
const MIN_OVERLAP_DEPTH = 0.5;

/**
 * How much of a line a shape has to swallow before it counts as swallowing it.
 *
 * This is the main guard against crying wolf. An edge that clips the corner of
 * a box for two pixels has not disappeared into it, and marking that would put
 * a mark on most diagrams that are fine. Summed over the legs of the route, so
 * a line that crosses a shape twice is judged on the total it loses.
 */
const MIN_HIDDEN_SPAN = 4;

export type Shape = {
  id: string;
  /** the outline, as a convex polygon in absolute coordinates */
  polygon: Vec[];
  /**
   * Whether a line running under this shape is lost behind it.
   *
   * False for an aggregation container: its fill is 26% opaque, so it tints a
   * line rather than hiding one, and it legitimately covers every edge drawn
   * between its own members. It is still a shape for the overlap test, where it
   * hides things perfectly well.
   */
  occludesEdges: boolean;
  /** ids of the aggregation containers this shape sits inside, innermost first */
  containerIds: string[];
};

export type Route = {
  id: string;
  sourceId: string;
  targetId: string;
  /** the drawn path: two points when straight, more when routed orthogonally */
  points: Vec[];
};

export type ShapeOcclusion = {
  id: string;
  kind: "shape";
  /** the two shapes, sorted, so the id survives a rebuild reordering the nodes */
  between: [string, string];
  /** the region they share, as a polygon */
  polygon: Vec[];
};

export type EdgeOcclusion = {
  id: string;
  kind: "edge";
  edgeId: string;
  sourceId: string;
  targetId: string;
  shapeId: string;
  /** the runs of line the shape swallows -- more than one if the route re-enters */
  spans: [Vec, Vec][];
};

export type Occlusion = ShapeOcclusion | EdgeOcclusion;

/**
 * Twice the signed area of a polygon.
 *
 * Only the sign is used, and only to state the winding convention the two clips
 * below depend on: every outline in nodeOutline.ts comes back positive, which
 * puts the inside of the shape to the left of each edge walked in order.
 */
export const signedArea = (polygon: Vec[]): number => {
  let total = 0;
  for (const [index, from] of polygon.entries()) {
    const to = polygon[(index + 1) % polygon.length];
    total += from.x * to.y - to.x * from.y;
  }
  return total;
};

/** Which side of the line a->b a point falls on. Positive is the inside. */
const sideOf = (a: Vec, b: Vec, point: Vec) =>
  (b.x - a.x) * (point.y - a.y) - (b.y - a.y) * (point.x - a.x);

const near = (a: Vec, b: Vec) =>
  Math.abs(a.x - b.x) < VERTEX_EPSILON && Math.abs(a.y - b.y) < VERTEX_EPSILON;

/** Drops points that repeat the one before them, and the wrap-around repeat. */
const dedupe = (polygon: Vec[]): Vec[] => {
  const kept = polygon.filter(
    (point, index) => index === 0 || !near(point, polygon[index - 1]),
  );
  return kept.length > 1 && near(kept[0], kept[kept.length - 1])
    ? kept.slice(0, -1)
    : kept;
};

/**
 * The region two convex polygons share, by Sutherland-Hodgman.
 *
 * Clipping one polygon against another this way needs the *clip* to be convex,
 * and here both are -- box, diamond, triangle and sampled ellipse -- so it may
 * be run either way round. Nothing enforces that beyond the fact that an ER
 * diagram has no concave symbol, which is why the convexity of every outline is
 * pinned by a test rather than assumed here.
 *
 * Containment needs no special case: the inner polygon survives every plane
 * untouched. Two shapes that merely touch come back as a line of collinear
 * points, which `minWidth` then measures as zero.
 */
export const clipConvex = (subject: Vec[], clip: Vec[]): Vec[] => {
  if (subject.length < 3 || clip.length < 3) return [];

  let output = subject;
  for (const [index, a] of clip.entries()) {
    if (output.length === 0) return [];
    const b = clip[(index + 1) % clip.length];

    const input = output;
    output = [];
    for (const [at, current] of input.entries()) {
      const previous = input[(at + input.length - 1) % input.length];
      const here = sideOf(a, b, current);
      const there = sideOf(a, b, previous);

      // opposite signs, so the difference cannot be zero
      const crossing = (): Vec => {
        const along = there / (there - here);
        return {
          x: previous.x + along * (current.x - previous.x),
          y: previous.y + along * (current.y - previous.y),
        };
      };

      if (here >= 0) {
        if (there < 0) output.push(crossing());
        output.push(current);
      } else if (there >= 0) {
        output.push(crossing());
      }
    }
    output = dedupe(output);
  }

  return output;
};

/**
 * The narrowest the polygon is, across any direction.
 *
 * For a convex polygon the narrowest direction always lies square to one of its
 * own sides, so it is enough to take each side in turn and ask how far the
 * furthest vertex stands off it. That is "how deep does this overlap go", which
 * is the question a reader is really asking of a shared region -- unlike area,
 * which a long thin sliver can score highly on while being invisible.
 */
export const minWidth = (polygon: Vec[]): number => {
  if (polygon.length < 3) return 0;

  let narrowest = Infinity;
  for (const [index, a] of polygon.entries()) {
    const b = polygon[(index + 1) % polygon.length];
    const length = Math.hypot(b.x - a.x, b.y - a.y);
    if (length < PARALLEL_EPSILON) continue;

    let furthest = 0;
    for (const point of polygon)
      furthest = Math.max(furthest, Math.abs(sideOf(a, b, point)) / length);
    narrowest = Math.min(narrowest, furthest);
  }

  return Number.isFinite(narrowest) ? narrowest : 0;
};

/**
 * The part of the segment that falls inside the polygon, by Cyrus-Beck.
 *
 * A parametric clip rather than a polygon one: what is wanted here is the run
 * of line the shape covers, and walking the sides while narrowing the interval
 * the segment may still occupy hands that back directly. Null when the segment
 * misses the shape, or is too short to have a direction.
 */
export const clipSegmentToPolygon = (
  from: Vec,
  to: Vec,
  polygon: Vec[],
): [Vec, Vec] | null => {
  if (polygon.length < 3) return null;

  const along = { x: to.x - from.x, y: to.y - from.y };
  if (Math.hypot(along.x, along.y) < PARALLEL_EPSILON) return null;

  let enters = 0;
  let leaves = 1;
  for (const [index, a] of polygon.entries()) {
    const b = polygon[(index + 1) % polygon.length];
    // the inside is to the left of a->b, so the outward normal is to the right
    const outward = { x: b.y - a.y, y: -(b.x - a.x) };

    const rate = outward.x * along.x + outward.y * along.y;
    const offset = outward.x * (from.x - a.x) + outward.y * (from.y - a.y);

    if (Math.abs(rate) < PARALLEL_EPSILON) {
      // Runs parallel to this side, so it is wholly inside it or wholly out --
      // and a line lying exactly *on* it counts as out. Orthogonal routing
      // makes that a real case rather than a degenerate one, since its legs are
      // axis aligned and so are the boxes: a leg can run along a box's edge,
      // where it is drawn beside the shape rather than lost behind it.
      if (offset >= 0) return null;
      continue;
    }

    const at = -offset / rate;
    if (rate < 0) enters = Math.max(enters, at);
    else leaves = Math.min(leaves, at);
    if (enters >= leaves) return null;
  }

  const point = (at: number): Vec => ({
    x: from.x + at * along.x,
    y: from.y + at * along.y,
  });
  return [point(enters), point(leaves)];
};

const boundsOf = (id: string, polygon: Vec[]) => ({
  id,
  ...polygonBounds(polygon),
});

const spanLength = ([a, b]: [Vec, Vec]) => Math.hypot(b.x - a.x, b.y - a.y);

/**
 * Everything in the diagram that is hidden behind something else.
 *
 * Shape pairs first, because the edge pass reads them: once two shapes are
 * known to overlap, every edge arriving at one of them also runs into the
 * other, and reporting those separately would turn a single defect into a mark
 * per edge -- the count inflating exactly where the reader most needs it to
 * mean something.
 */
export const findOcclusions = (
  shapes: Shape[],
  routes: Route[],
): Occlusion[] => {
  const bounds = new Map(
    shapes.map((shape) => [shape.id, boundsOf(shape.id, shape.polygon)]),
  );

  const shapeMarks: ShapeOcclusion[] = [];
  const overlaps = new Map<string, Set<string>>();
  const noteOverlap = (a: string, b: string) => {
    if (!overlaps.has(a)) overlaps.set(a, new Set());
    overlaps.get(a)!.add(b);
  };

  for (const [index, a] of shapes.entries())
    for (const b of shapes.slice(index + 1)) {
      // a container and what it contains overlap by design. Anything else
      // sitting in an aggregation box is not exempt: it reads as a member
      if (a.containerIds.includes(b.id) || b.containerIds.includes(a.id))
        continue;
      if (!rectsOverlap(bounds.get(a.id)!, bounds.get(b.id)!)) continue;

      const region = clipConvex(a.polygon, b.polygon);
      if (minWidth(region) < MIN_OVERLAP_DEPTH) continue;

      const between: [string, string] =
        a.id < b.id ? [a.id, b.id] : [b.id, a.id];
      shapeMarks.push({
        id: `shape:${between[0]}|${between[1]}`,
        kind: "shape",
        between,
        polygon: region,
      });
      noteOverlap(a.id, b.id);
      noteOverlap(b.id, a.id);
    }

  const edgeMarks: EdgeOcclusion[] = [];
  for (const route of routes) {
    if (route.points.length < 2) continue;
    const routeBounds = boundsOf(route.id, route.points);

    for (const shape of shapes) {
      if (!shape.occludesEdges) continue;
      if (shape.id === route.sourceId || shape.id === route.targetId) continue;
      // An edge drawn to an aggregation stops on the container's outline, so it
      // never reaches what the container holds. Without this, every element in
      // a box appears to swallow every edge arriving at the box -- which is how
      // `aggregation` and `bank` first read, and neither has anything wrong
      // with it.
      if (
        shape.containerIds.includes(route.sourceId) ||
        shape.containerIds.includes(route.targetId)
      )
        continue;
      const already = overlaps.get(shape.id);
      if (already?.has(route.sourceId) || already?.has(route.targetId))
        continue;
      if (!rectsOverlap(routeBounds, bounds.get(shape.id)!)) continue;

      const spans: [Vec, Vec][] = [];
      for (const [index, point] of route.points.slice(0, -1).entries()) {
        const span = clipSegmentToPolygon(
          point,
          route.points[index + 1],
          shape.polygon,
        );
        if (span !== null) spans.push(span);
      }

      const hidden = spans.reduce((total, span) => total + spanLength(span), 0);
      if (hidden < MIN_HIDDEN_SPAN) continue;

      edgeMarks.push({
        id: `edge:${route.id}|${shape.id}`,
        kind: "edge",
        edgeId: route.id,
        sourceId: route.sourceId,
        targetId: route.targetId,
        shapeId: shape.id,
        spans,
      });
    }
  }

  return [...shapeMarks, ...edgeMarks];
};
