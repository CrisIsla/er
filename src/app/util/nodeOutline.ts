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

type Vec = { x: number; y: number };

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

export type OutlineHit = {
  /** Distance from the centre of the node's box to the outline. */
  distance: number;
  /** Direction the outline faces where it was hit, as an angle. */
  normal: number;
};

/**
 * Where the ray leaving the centre of `node`'s box along `angle` meets the
 * shape, and which way the shape faces there. Angles are measured as on the
 * canvas: 0 points right and y grows downwards.
 *
 * A node React Flow has not measured yet has no outline to speak of, and is
 * reported as a zero distance facing along the ray.
 */
export const outlineHit = (node: OutlineNode, angle: number): OutlineHit => {
  const width = node.width ?? 0;
  const height = node.height ?? 0;
  if (width <= 0 || height <= 0) return { distance: 0, normal: angle };

  const direction = { x: Math.cos(angle), y: Math.sin(angle) };
  const outline = outlineOf(node);

  const semiX = width / 2;
  const semiY = height / 2;

  if (outline === "ellipse") {
    // (t*cos / a)^2 + (t*sin / b)^2 = 1
    const distance = 1 / Math.hypot(direction.x / semiX, direction.y / semiY);
    // the ellipse faces along its gradient at the point that was hit
    return {
      distance,
      normal: Math.atan2(
        (distance * direction.y) / (semiY * semiY),
        (distance * direction.x) / (semiX * semiX),
      ),
    };
  }

  // the ray starts inside a convex polygon, so exactly one edge is crossed;
  // the smallest positive hit is taken in case a corner is grazed twice
  let nearest = Infinity;
  let facing = angle;
  for (const [index, from] of outline.entries()) {
    const to = outline[(index + 1) % outline.length];
    const start = { x: from.x * width, y: from.y * height };
    const edge = { x: (to.x - from.x) * width, y: (to.y - from.y) * height };

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
