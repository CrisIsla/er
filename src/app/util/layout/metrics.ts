/**
 * Objective measures of how good a layout is.
 *
 * These serve two purposes at once: the placement cost function scores
 * candidates with them, and the tests use them to compare a run against a
 * recorded baseline. There was no way to measure diagram quality in this repo
 * before -- quality was entirely delegated to ELK's internals.
 */

import { Rect, centerOf } from "../alignmentCandidates";
import { rectsOverlap, segmentsCross } from "./geometry";
import { buildHierarchyForest } from "./hierarchy";
import { Box, LayoutGraph, Placement, Vec } from "./types";

export type Segment = { a: Vec; b: Vec };

export const segmentLength = (segment: Segment) =>
  Math.hypot(segment.b.x - segment.a.x, segment.b.y - segment.a.y);

/** Horizontal or vertical, within a pixel of tolerance. */
export const isAxisAligned = (segment: Segment, tolerance = 1) =>
  Math.abs(segment.b.x - segment.a.x) <= tolerance ||
  Math.abs(segment.b.y - segment.a.y) <= tolerance;

export const countCrossings = (segments: Segment[]) => {
  let crossings = 0;
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++)
      if (
        segmentsCross(
          segments[i].a,
          segments[i].b,
          segments[j].a,
          segments[j].b,
        )
      )
        crossings++;
  return crossings;
};

export const totalLength = (segments: Segment[]) =>
  segments.reduce((total, segment) => total + segmentLength(segment), 0);

export const countAxisAligned = (segments: Segment[], tolerance = 1) =>
  segments.filter((segment) => isAxisAligned(segment, tolerance)).length;

export const boundingBox = (rects: Rect[]): Box => {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const minX = Math.min(...rects.map((rect) => rect.x));
  const minY = Math.min(...rects.map((rect) => rect.y));
  const maxX = Math.max(...rects.map((rect) => rect.x + rect.width));
  const maxY = Math.max(...rects.map((rect) => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
};

/** Pairs of rectangles closer together than `gap`. Should be 0 in a finished layout. */
export const countOverlaps = (rects: Rect[], gap = 0) => {
  let overlaps = 0;
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      if (rectsOverlap(rects[i], rects[j], gap)) overlaps++;
  return overlaps;
};

/** Pairs of rectangles sharing a horizontal or vertical centre line. */
export const countAlignedPairs = (rects: Rect[], tolerance = 0.5) => {
  let aligned = 0;
  for (let i = 0; i < rects.length; i++)
    for (let j = i + 1; j < rects.length; j++)
      if (
        Math.abs(centerOf(rects[i], "x") - centerOf(rects[j], "x")) <=
          tolerance ||
        Math.abs(centerOf(rects[i], "y") - centerOf(rects[j], "y")) <= tolerance
      )
        aligned++;
  return aligned;
};

export type DiagramMetrics = {
  crossings: number;
  overlaps: number;
  /** bounding-box area, in square pixels */
  area: number;
  totalEdgeLength: number;
  edges: number;
  axisAlignedEdges: number;
  alignedPairs: number;
};

/** A drawn edge, carrying the ids it runs between. */
export type DrawnSegment = Segment & { from: string; to: string };

/**
 * Edges that disappear into an element they do not join.
 *
 * Nothing else measures this. `countCrossings` sees only segment against
 * segment, so an edge routed straight through the middle of a box costs
 * nothing -- and it is arguably worse than a crossing, because a crossing is at
 * least legible. On `company` the edge from `Works_on` to `Employee` runs
 * through `Department`, and the one from `Supplies` to `Supplier` runs through
 * `Project`, and the layout has no way to know.
 *
 * Tested against the rectangle's four sides rather than its bounding box, so a
 * slanted edge is judged as exactly as an axis-aligned one.
 */
export const edgesThroughNodes = (
  rects: Rect[],
  segments: DrawnSegment[],
  /** e.g. an aggregation container, which legitimately encloses its members */
  encloses: (rectId: string, nodeId: string) => boolean = () => false,
) => {
  let through = 0;
  for (const segment of segments)
    for (const rect of rects) {
      if (rect.id === segment.from || rect.id === segment.to) continue;
      if (encloses(rect.id, segment.from) || encloses(rect.id, segment.to))
        continue;
      const { x, y, width, height } = rect;
      const corners = [
        { x, y },
        { x: x + width, y },
        { x: x + width, y: y + height },
        { x, y: y + height },
      ];
      const hit = corners.some((corner, index) =>
        segmentsCross(
          segment.a,
          segment.b,
          corner,
          corners[(index + 1) % corners.length],
        ),
      );
      if (hit) through++;
    }
  return through;
};

/** How close a point comes to a segment. */
export const distanceToSegment = (point: Vec, segment: Segment) => {
  const dx = segment.b.x - segment.a.x;
  const dy = segment.b.y - segment.a.y;
  const length = dx * dx + dy * dy;
  const t =
    length === 0
      ? 0
      : Math.max(
          0,
          Math.min(
            1,
            ((point.x - segment.a.x) * dx + (point.y - segment.a.y) * dy) /
              length,
          ),
        );
  return Math.hypot(
    point.x - (segment.a.x + t * dx),
    point.y - (segment.a.y + t * dy),
  );
};

/**
 * How near the nearest attribute comes to a line it does not belong to.
 *
 * The rectangle tests cannot see this. An attribute is an ellipse hung a fixed
 * distance off its owner, and a relationship edge is a thin line -- the two
 * cross without either box overlapping anything, and the attribute reads as
 * belonging to whatever the line joins. `placeAttributes` knows only the angles
 * of its owner's own connectors, so nothing else prevents it.
 *
 * `segments` are the drawn structural edges, each carrying the ids it runs
 * between so an attribute can be excused the spokes of its own owner -- those it
 * is drawn beside on purpose.
 */
export const nearestAttributeApproach = (
  attributes: { id: string; centre: Vec; ownerId: string }[],
  segments: (Segment & { from: string; to: string })[],
) => {
  let nearest = Infinity;
  let worst: string | null = null;
  for (const attribute of attributes)
    for (const segment of segments) {
      // the spokes of its own owner are what it is drawn beside on purpose
      if (
        segment.from === attribute.ownerId ||
        segment.to === attribute.ownerId
      )
        continue;
      const distance = distanceToSegment(attribute.centre, segment);
      if (distance < nearest) {
        nearest = distance;
        worst = attribute.id;
      }
    }
  return { nearest, worst };
};

/**
 * How well the ISA hierarchies are drawn.
 *
 * Deliberately not folded into `DiagramMetrics`: the general measures apply to
 * every diagram, these apply to the three examples that have an `extends`, and
 * reporting `NaN` for the rest would make the baseline table unreadable. (It is
 * also what keeps `diagramMetrics`'s recorded shape intact.)
 */
export type HierarchyMetrics = {
  /** ISA links the forest captured */
  links: number;
  /** ...of which are drawn with the subclass strictly below its superclass */
  downward: number;
  /** members sharing their layer's most common y, over all members */
  onLayerRow: number;
  members: number;
  /** the widest spread of y within a single layer, in pixels. 0 is a clean tree */
  layerSpread: number;
};

export const hierarchyMetrics = (
  graph: LayoutGraph,
  centres: Placement,
  order: string[] = [],
): HierarchyMetrics => {
  const forest = buildHierarchyForest(graph, order);

  let downward = 0;
  for (const { parentId, childId } of forest.links) {
    const parent = centres.get(parentId);
    const child = centres.get(childId);
    if (parent !== undefined && child !== undefined && child.y > parent.y)
      downward++;
  }

  // layers are numbered per tree but compared per tree as well: two independent
  // hierarchies have no reason to share a baseline, and scoring them against one
  // would report a clean pair of trees as broken
  let onLayerRow = 0;
  let members = 0;
  let layerSpread = 0;
  for (const ids of forest.membersOf.values()) {
    const rows = new Map<number, number[]>();
    for (const id of ids) {
      const centre = centres.get(id);
      if (centre === undefined) continue;
      const layer = forest.layerOf.get(id)!;
      rows.set(layer, [...(rows.get(layer) ?? []), centre.y]);
    }
    for (const ys of rows.values()) {
      members += ys.length;
      const counts = new Map<number, number>();
      for (const y of ys) counts.set(y, (counts.get(y) ?? 0) + 1);
      onLayerRow += Math.max(...counts.values());
      layerSpread = Math.max(layerSpread, Math.max(...ys) - Math.min(...ys));
    }
  }

  return {
    links: forest.links.length,
    downward,
    onLayerRow,
    members,
    layerSpread,
  };
};

export const diagramMetrics = (
  rects: Rect[],
  segments: Segment[],
  gap = 0,
): DiagramMetrics => {
  const box = boundingBox(rects);
  return {
    crossings: countCrossings(segments),
    overlaps: countOverlaps(rects, gap),
    area: box.width * box.height,
    totalEdgeLength: totalLength(segments),
    edges: segments.length,
    axisAlignedEdges: countAxisAligned(segments),
    alignedPairs: countAlignedPairs(rects),
  };
};
