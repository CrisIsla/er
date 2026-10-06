/**
 * How far a node's drawn outline sits from the centre of its box.
 *
 * React Flow only measures a node's box, but each ER shape fills that box
 * differently: an entity covers it, an attribute is the ellipse inscribed in it,
 * a relationship is a square rotated inside it -- so it reaches past the box --
 * and an ISA triangle covers only part of it. An edge aiming at a node's centre
 * is cut back to this distance, so it stops where the shape is actually drawn
 * and whatever marker it carries sits on the outline instead of inside the fill.
 *
 * Free of React Flow types: the node shape below is structurally compatible.
 */

import { isAttributeNode } from "./erGraph";

export type OutlineNode = {
  type?: string;
  width?: number | null;
  height?: number | null;
};

export type Vec = { x: number; y: number };

const cross = (a: Vec, b: Vec) => a.x * b.y - a.y * b.x;

/**
 * The ISA triangle, as fractions of its node box.
 *
 * DefaultIsA.tsx draws `M8,0 L88,0 L48,70` in a 96x24rem/4 = 96x64 svg with
 * overflow visible, which is why the apex reaches below the box. Keep in step
 * with that path.
 */
const ISA_TRIANGLE: Vec[] = [
  { x: 8 / 96 - 0.5, y: 0 / 64 - 0.5 },
  { x: 88 / 96 - 0.5, y: 0 / 64 - 0.5 },
  { x: 48 / 96 - 0.5, y: 70 / 64 - 0.5 },
];

/** Corners of the node box itself, for the shapes that fill it. */
const BOX: Vec[] = [
  { x: -0.5, y: -0.5 },
  { x: 0.5, y: -0.5 },
  { x: 0.5, y: 0.5 },
  { x: -0.5, y: 0.5 },
];

/**
 * The relationship diamond: a square with `rotate-45`, so its corners land on
 * the middles of the box's sides and its diagonal -- not its side -- is what the
 * box measures. Same correction as visualSize() in util/layout/geometry.ts.
 */
const DIAMOND: Vec[] = (() => {
  const reach = Math.SQRT2 / 2;
  return [
    { x: reach, y: 0 },
    { x: 0, y: reach },
    { x: -reach, y: 0 },
    { x: 0, y: -reach },
  ];
})();

const outlineOf = (node: OutlineNode): Vec[] | "ellipse" => {
  if (isAttributeNode(node)) return "ellipse";
  if (node.type === "relationship") return DIAMOND;
  if (node.type === "isA") return ISA_TRIANGLE;
  return BOX;
};

/**
 * How many points an attribute's ellipse is drawn as when it has to be a
 * polygon.
 *
 * The polygon is strictly *inscribed*, so the error only ever goes one way: at
 * 24 points the worst gap is about 0.2px on a 200x44 attribute, which can miss
 * a hairline overlap but can never invent one. Sampling uniformly in the angle
 * also clusters points at the ends of the major axis, which is where the
 * curvature -- and so the error -- is greatest.
 */
const ELLIPSE_SAMPLES = 24;

const ellipseOutline = (samples: number): Vec[] =>
  Array.from({ length: samples }, (_, index) => {
    const angle = (Math.PI * 2 * index) / samples;
    return { x: Math.cos(angle) / 2, y: Math.sin(angle) / 2 };
  });

/**
 * The shape a node actually covers, as a convex polygon in absolute
 * coordinates.
 *
 * `outlineHit` answers "how far is the outline in this direction", which is all
 * an edge endpoint needs. Asking whether two shapes overlap needs the whole
 * outline at once, and needs it as a polygon rather than as a rectangle: a
 * diamond covers half of the box that measures it, an ISA triangle 46% of its
 * own -- and the triangle's apex reaches 6px *below* the box, which no
 * rectangle drawn from the box can express at all.
 *
 * Every ER shape is convex, which is what lets callers clip one against
 * another. A node React Flow has not measured yet has no outline and comes back
 * empty.
 *
 * All four outlines wind the same way -- positive shoelace area -- so the
 * inside of the shape is consistently on the left of each edge, walking it in
 * order. Reversing one would silently invert that test rather than fail, so it
 * is pinned by a test.
 */
export const outlinePolygon = (
  node: OutlineNode,
  center: Vec,
  samples: number = ELLIPSE_SAMPLES,
): Vec[] => {
  const width = node.width ?? 0;
  const height = node.height ?? 0;
  if (width <= 0 || height <= 0) return [];

  const outline = outlineOf(node);
  const unit = outline === "ellipse" ? ellipseOutline(samples) : outline;

  return unit.map((point) => ({
    x: center.x + point.x * width,
    y: center.y + point.y * height,
  }));
};

/**
 * The smallest axis-aligned box holding a polygon.
 *
 * This is what pairs of shapes are prefiltered with, and what the overlay sizes
 * itself from -- *not* `visualRectOf`, which corrects the relationship diamond
 * and nothing else, so it would clip an ISA triangle at the apex.
 */
export const polygonBounds = (
  polygon: Vec[],
): { x: number; y: number; width: number; height: number } => {
  if (polygon.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const xs = polygon.map((point) => point.x);
  const ys = polygon.map((point) => point.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y };
};

export type OutlineHit = {
  /** Distance from where the ray started to the outline. */
  distance: number;
  /** Direction the outline faces where it was hit, as an angle. */
  normal: number;
};

/** The centre of a node's own box, which is where a ray usually starts. */
const CENTRE: Vec = { x: 0, y: 0 };

/**
 * How far the ray from `origin` along `direction` runs before it meets the
 * ellipse inscribed in a `2*semiX` by `2*semiY` box.
 *
 * From the centre this is the closed form the shape's equation gives directly.
 * From anywhere else it is the positive root of that equation along the ray:
 * `t^2*a + t*b + c = 0`, where `c` is negative for any origin inside the
 * ellipse, so the root exists and there is exactly one of it. An origin that
 * somehow lands outside has no positive root, and is reported as no hit.
 */
const ellipseReach = (
  origin: Vec,
  direction: Vec,
  semiX: number,
  semiY: number,
): number => {
  if (origin.x === 0 && origin.y === 0)
    return 1 / Math.hypot(direction.x / semiX, direction.y / semiY);

  const a =
    (direction.x * direction.x) / (semiX * semiX) +
    (direction.y * direction.y) / (semiY * semiY);
  const b =
    2 *
    ((origin.x * direction.x) / (semiX * semiX) +
      (origin.y * direction.y) / (semiY * semiY));
  const c =
    (origin.x * origin.x) / (semiX * semiX) +
    (origin.y * origin.y) / (semiY * semiY) -
    1;

  const discriminant = b * b - 4 * a * c;
  if (discriminant < 0 || a === 0) return 0;
  const reach = (-b + Math.sqrt(discriminant)) / (2 * a);
  return reach > 0 ? reach : 0;
};

/**
 * Where the ray leaving `origin` -- a point given relative to the centre of
 * `node`'s box -- along `angle` meets the shape, and which way the shape faces
 * there. Angles are measured as on the canvas: 0 points right and y grows
 * downwards.
 *
 * `outlineHit` is this from the centre, which is what a line aimed at a shape
 * needs. An origin off the centre is what several lines between the same pair
 * of shapes need: moving the origin across the line, rather than turning the
 * ray, leaves every one of them parallel to the line they would have drawn, so
 * each still leaves its shape instead of cutting back through it. Turning the
 * ray does not, because the line drawn between two turned rays no longer runs
 * along either of them (useEdgePath.tsx).
 *
 * A node React Flow has not measured yet has no outline to speak of, and is
 * reported as a zero distance facing along the ray.
 */
export const outlineExit = (
  node: OutlineNode,
  origin: Vec,
  angle: number,
): OutlineHit => {
  const width = node.width ?? 0;
  const height = node.height ?? 0;
  if (width <= 0 || height <= 0) return { distance: 0, normal: angle };

  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const outline = outlineOf(node);

  const semiX = width / 2;
  const semiY = height / 2;

  if (outline === "ellipse") {
    const distance = ellipseReach(origin, direction, semiX, semiY);
    if (distance === 0) return { distance: 0, normal: angle };
    // the ellipse faces along its gradient at the point that was hit
    const point = {
      x: origin.x + distance * direction.x,
      y: origin.y + distance * direction.y,
    };
    return {
      distance,
      normal: Math.atan2(point.y / (semiY * semiY), point.x / (semiX * semiX)),
    };
  }

  // the ray starts inside a convex polygon, so exactly one edge is crossed;
  // the smallest positive hit is taken in case a corner is grazed twice
  let nearest = Infinity;
  let facing = angle;
  for (const [index, corner] of outline.entries()) {
    const next = outline[(index + 1) % outline.length];
    // measured from the origin, so the ray is the one being solved for
    const start = {
      x: corner.x * width - origin.x,
      y: corner.y * height - origin.y,
    };
    const edge = {
      x: (next.x - corner.x) * width,
      y: (next.y - corner.y) * height,
    };

    const denominator = cross(direction, edge);
    if (Math.abs(denominator) < 1e-9) continue;

    const along = cross(start, edge) / denominator;
    const acrossEdge = cross(start, direction) / denominator;
    if (along > 0 && acrossEdge >= 0 && acrossEdge <= 1 && along < nearest) {
      nearest = along;
      // of the two perpendiculars to the edge, the one the ray runs into
      const outward = { x: edge.y, y: -edge.x };
      const towardsRay =
        outward.x * direction.x + outward.y * direction.y > 0 ? 1 : -1;
      facing = Math.atan2(towardsRay * outward.y, towardsRay * outward.x);
    }
  }

  return {
    distance: Number.isFinite(nearest) ? nearest : 0,
    normal: facing,
  };
};

/**
 * Where the ray leaving the centre of `node`'s box along `angle` meets the
 * shape, and which way the shape faces there.
 */
export const outlineHit = (node: OutlineNode, angle: number): OutlineHit =>
  outlineExit(node, CENTRE, angle);

/** Just the distance part of outlineHit(). */
export const outlineDistance = (node: OutlineNode, angle: number): number =>
  outlineHit(node, angle).distance;

/**
 * How far past the endpoint a stroke of `strokeWidth` has to run for its end cap
 * to be buried in the shape.
 *
 * A stroke is a band, and SVG ends it square to the line it follows rather than
 * square to whatever it is arriving at. Meeting a shape at an angle, one rail of
 * the band therefore stops short of the outline -- by half the width times the
 * sine of that angle -- and hangs in the open, while the other crosses it. Push
 * the band this much further in and the whole cap lands under the shape, which
 * paints over the edges.
 */
export const capBurial = (
  strokeWidth: number,
  lineAngle: number,
  facing: number,
): number => {
  const skew = lineAngle - facing;
  const headOn = Math.abs(Math.cos(skew));
  if (headOn < 1e-3) return strokeWidth * 3;
  return Math.min(
    (strokeWidth / 2) * (Math.abs(Math.sin(skew)) / headOn),
    strokeWidth * 3,
  );
};
