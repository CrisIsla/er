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
import { Box, Vec } from "./types";

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
