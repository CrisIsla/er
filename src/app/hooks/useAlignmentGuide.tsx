import { useCallback, useRef, useState } from "react";
import { Node, NodeDragHandler, useReactFlow } from "reactflow";
import {
  Candidate,
  Rect,
  STRUCTURAL_TYPES,
  endOf,
  findActiveCandidates,
  startOf,
  toAbsoluteRects,
} from "../util/alignmentCandidates";
import { useDiagramSettings } from "./useDiagramSettings";

/** How close, in px, a node must be for a guide to appear when magnetic
 * alignment is off. With it on we use the configured snap radius instead, so
 * the guide predicts where the node is about to land. */
const GUIDE_TOLERANCE = 6;

/** A line for the overlay to draw, in flow coordinates. */
export type GuideLine = {
  id: string;
  kind: "align" | "spacing";
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  label?: string;
  labelX?: number;
  labelY?: number;
};

const boundsOf = (rects: Rect[], axis: "x" | "y") => ({
  min: Math.min(...rects.map((r) => startOf(r, axis))),
  max: Math.max(...rects.map((r) => endOf(r, axis))),
});

/** Where the dragged rect would sit if it took this candidate. */
const draggedAtCandidate = (dragged: Rect, candidate: Candidate): Rect =>
  candidate.axis === "x"
    ? { ...dragged, x: candidate.value - dragged.width / 2 }
    : { ...dragged, y: candidate.value - dragged.height / 2 };

/**
 * Turns an active candidate into drawable lines.
 *
 * Alignment renders as a single line through the shared centres. Spacing
 * renders as the two equal gaps it is claiming, each labelled with its size,
 * which is what makes the guide readable -- a bare line would not tell the
 * user *why* the position is special.
 */
const toGuideLines = (
  candidate: Candidate,
  dragged: Rect,
  byId: Map<string, Rect>,
): GuideLine[] => {
  const refs = candidate.refIds
    .map((id) => byId.get(id))
    .filter((r): r is Rect => r !== undefined);
  if (refs.length === 0) return [];

  const axis = candidate.axis;
  const cross = axis === "x" ? "y" : "x";
  const ghost = draggedAtCandidate(dragged, candidate);

  if (candidate.kind === "align") {
    const { min, max } = boundsOf([ghost, ...refs], cross);
    const id = `align-${axis}-${candidate.value}`;
    return [
      axis === "x"
        ? {
            id,
            kind: "align",
            x1: candidate.value,
            y1: min,
            x2: candidate.value,
            y2: max,
          }
        : {
            id,
            kind: "align",
            x1: min,
            y1: candidate.value,
            x2: max,
            y2: candidate.value,
          },
    ];
  }

  // spacing: draw the existing gap between the two refs, and the matching gap
  // between the nearer ref and where the dragged node would land
  const ordered = [...refs].sort((a, b) => startOf(a, axis) - startOf(b, axis));
  const [first, second] = ordered;
  if (!second) return [];

  const draggedAfter = startOf(ghost, axis) >= endOf(second, axis);
  const newGapFrom = draggedAfter ? endOf(second, axis) : endOf(ghost, axis);
  const newGapTo = draggedAfter ? startOf(ghost, axis) : startOf(first, axis);

  // draw both gap markers on a shared line through the middle of the run
  const centerCross =
    (Math.min(...[ghost, ...refs].map((r) => startOf(r, cross))) +
      Math.max(...[ghost, ...refs].map((r) => endOf(r, cross)))) /
    2;

  const seg = (from: number, to: number, suffix: string): GuideLine => {
    const label = `${Math.round(candidate.gap ?? 0)}`;
    const mid = (from + to) / 2;
    return axis === "x"
      ? {
          id: `spacing-${axis}-${candidate.value}-${suffix}`,
          kind: "spacing",
          x1: from,
          y1: centerCross,
          x2: to,
          y2: centerCross,
          label,
          labelX: mid,
          labelY: centerCross,
        }
      : {
          id: `spacing-${axis}-${candidate.value}-${suffix}`,
          kind: "spacing",
          x1: centerCross,
          y1: from,
          x2: centerCross,
          y2: to,
          label,
          labelX: centerCross,
          labelY: mid,
        };
  };

  return [
    seg(endOf(first, axis), startOf(second, axis), "existing"),
    seg(newGapFrom, newGapTo, "new"),
  ];
};

/**
 * Computes alignment and equal-spacing guides while a node is dragged.
 *
 * Guides are returned as plain geometry for an overlay to draw. They used to be
 * synthesised as React Flow edges with an "ALIGN" id prefix, which meant every
 * consumer of the edge list had to know to skip them -- the layout trigger and
 * the attribute-visibility sync both still carry that workaround.
 */
export const useAlignmentGuide = () => {
  const { getNodes } = useReactFlow();
  const { settings } = useDiagramSettings();
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const draggingRef = useRef<string | null>(null);

  const onNodeDragStart: NodeDragHandler = useCallback((_evt, node) => {
    draggingRef.current = node.id;
  }, []);

  const onNodeDrag: NodeDragHandler = useCallback(
    (_evt, node: Node) => {
      const allNodes = getNodes();
      // the store lags the pointer by a frame during a drag, so trust the
      // position React Flow just handed us
      const live = allNodes.map((n) =>
        n.id === node.id ? { ...n, position: node.position } : n,
      );

      const draggedIsStructural = STRUCTURAL_TYPES.includes(node.type ?? "");
      const [draggedRect] = toAbsoluteRects(
        live.filter((n) => n.id === node.id),
        { structuralOnly: false },
      );
      if (!draggedRect) return;

      // aligning an entity against attribute ovals is noise; aligning an
      // attribute against its siblings is not
      const others = toAbsoluteRects(
        live.filter((n) => n.id !== node.id),
        { structuralOnly: draggedIsStructural },
      );
      if (others.length === 0) {
        setGuides((prev) => (prev.length ? [] : prev));
        return;
      }

      const tolerance = settings.snapEnabled
        ? settings.snapRadius
        : GUIDE_TOLERANCE;

      const active = findActiveCandidates(draggedRect, others, tolerance, {
        includeSpacing: settings.spacingGuidesEnabled,
      });

      const byId = new Map(others.map((r) => [r.id, r]));
      const lines = active.flatMap((candidate) =>
        toGuideLines(candidate, draggedRect, byId),
      );

      setGuides((prev) => {
        // avoid a re-render per frame when nothing changed
        if (
          prev.length === lines.length &&
          prev.every(
            (p, i) =>
              p.id === lines[i].id &&
              p.x1 === lines[i].x1 &&
              p.y1 === lines[i].y1,
          )
        )
          return prev;
        return lines;
      });
    },
    [
      getNodes,
      settings.snapEnabled,
      settings.snapRadius,
      settings.spacingGuidesEnabled,
    ],
  );

  const onNodeDragStop: NodeDragHandler = useCallback(() => {
    draggingRef.current = null;
    setGuides([]);
  }, []);

  return { onNodeDragStart, onNodeDrag, onNodeDragStop, guides };
};
