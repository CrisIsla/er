/**
 * Plain geometry for the discrete-search layout: vectors, grid snapping,
 * rectangle clearance, segment crossing and the free-sector search used to fan
 * attributes out around an element.
 *
 * Rect is borrowed from alignmentCandidates.ts so the manual guides and the
 * automatic layout agree on what a rectangle is.
 */

import { Rect } from "../alignmentCandidates";
import { Vec } from "./types";

export const TAU = Math.PI * 2;

/**
 * The 8 directions a candidate position can take from an anchor.
 *
 * Axis-aligned first on purpose: candidate generation keeps this order, so when
 * two candidates score the same the orthogonal one is the one that wins.
 */
export const DIRECTIONS: readonly Vec[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
  { x: 1, y: 1 },
  { x: 1, y: -1 },
  { x: -1, y: 1 },
  { x: -1, y: -1 },
];

export const add = (a: Vec, b: Vec): Vec => ({ x: a.x + b.x, y: a.y + b.y });

export const subtract = (a: Vec, b: Vec): Vec => ({
  x: a.x - b.x,
  y: a.y - b.y,
});

export const scale = (v: Vec, k: number): Vec => ({ x: v.x * k, y: v.y * k });

export const distance = (a: Vec, b: Vec) => Math.hypot(a.x - b.x, a.y - b.y);

export const centroid = (points: Vec[]): Vec => {
  if (points.length === 0) return { x: 0, y: 0 };
  const sum = points.reduce(add, { x: 0, y: 0 });
  return scale(sum, 1 / points.length);
};

export const snap = (value: number, step: number) =>
  Math.round(value / step) * step;

export const snapVec = (v: Vec, step: number): Vec => ({
  x: snap(v.x, step),
  y: snap(v.y, step),
});

/**
 * What an element actually covers on screen.
 *
 * React Flow measures with offsetWidth/offsetHeight, which ignores CSS
 * transforms. The relationship diamond is a square with `rotate-45`
 * (DefaultRelationship.tsx), so it reports its unrotated side while covering its
 * diagonal -- 95x95 measured, ~134x134 on screen. Without this correction every
 * clearance test around a diamond is roughly 40px too optimistic.
 */
export const visualSize = (type: string, width: number, height: number) => {
  if (type !== "relationship") return { width, height };
  const diagonal = (width + height) / Math.SQRT2;
  return { width: diagonal, height: diagonal };
};

/** Rectangle covering `width` x `height` centred on `center`. */
export const rectAt = (
  id: string,
  center: Vec,
  width: number,
  height: number,
): Rect => ({
  id,
  x: center.x - width / 2,
  y: center.y - height / 2,
  width,
  height,
});

/**
 * What a node covers on screen, from the top-left position React Flow stores.
 *
 * The measured box and the visual box share a centre, so the diamond
 * correction grows symmetrically instead of pushing the shape off its anchor.
 */
export const visualRectOf = (
  id: string,
  type: string,
  position: Vec,
  width: number,
  height: number,
): Rect => {
  const visual = visualSize(type, width, height);
  return rectAt(
    id,
    { x: position.x + width / 2, y: position.y + height / 2 },
    visual.width,
    visual.height,
  );
};

export const centerOfRect = (rect: Rect): Vec => ({
  x: rect.x + rect.width / 2,
  y: rect.y + rect.height / 2,
});

/**
 * True when the two rectangles come within `gap` of each other -- that is, when
 * placing them like this would break the D_min clearance.
 */
export const rectsOverlap = (a: Rect, b: Rect, gap = 0) =>
  a.x - gap < b.x + b.width &&
  b.x - gap < a.x + a.width &&
  a.y - gap < b.y + b.height &&
  b.y - gap < a.y + a.height;

const cross = (o: Vec, a: Vec, b: Vec) =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/**
 * Proper segment intersection: segments that only touch at a shared endpoint do
 * not count. Every pair of edges leaving the same element shares an endpoint, so
 * without that rule a star of edges would score as a pile of crossings.
 */
export const segmentsCross = (p1: Vec, p2: Vec, p3: Vec, p4: Vec) => {
  const d1 = cross(p3, p4, p1);
  const d2 = cross(p3, p4, p2);
  const d3 = cross(p1, p2, p3);
  const d4 = cross(p1, p2, p4);
  return (
    ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) &&
    ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0))
  );
};

export const normalizeAngle = (angle: number) => {
  const wrapped = angle % TAU;
  return wrapped < 0 ? wrapped + TAU : wrapped;
};

export const angleOf = (from: Vec, to: Vec) =>
  normalizeAngle(Math.atan2(to.y - from.y, to.x - from.x));

export const pointOnCircle = (
  center: Vec,
  angle: number,
  radius: number,
): Vec => ({
  x: center.x + Math.cos(angle) * radius,
  y: center.y + Math.sin(angle) * radius,
});

export type Sector = {
  start: number;
  end: number;
  size: number;
  middle: number;
};

/**
 * The angular gaps left between the directions an element's edges leave in,
 * widest first. Attributes go in the widest gaps so they don't sit on top of the
 * lines connecting their owner to the rest of the diagram.
 */
export const freeSectors = (occupied: number[]): Sector[] => {
  const angles = Array.from(new Set(occupied.map(normalizeAngle))).sort(
    (a, b) => a - b,
  );
  if (angles.length === 0)
    return [{ start: 0, end: TAU, size: TAU, middle: Math.PI }];

  const sectors = angles.map((start, index) => {
    const end =
      index === angles.length - 1 ? angles[0] + TAU : angles[index + 1];
    const size = end - start;
    return { start, end, size, middle: normalizeAngle(start + size / 2) };
  });
  // Array.prototype.sort is stable, so equal-sized sectors keep their angular
  // order and the result stays reproducible.
  return sectors.sort((a, b) => b.size - a.size);
};

/** Is the value a whole multiple of `step`, within floating-point noise? */
export const isOnGrid = (value: number, step: number, epsilon = 1e-6) =>
  Math.abs(value - snap(value, step)) < epsilon;
