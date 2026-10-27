import { useCallback, useRef, useState } from "react";
import { Node, NodeDragHandler, useReactFlow } from "reactflow";
import {
  Candidate,
  Rect,
  STRUCTURAL_TYPES,
  endOf,
  absoluteRectOf,
  findActiveCandidates,
  movedByDrag,
  startOf,
  toAbsoluteRects,
} from "../util/alignmentCandidates";
import { obstaclesFor, slideOutOfCollisions } from "../util/collision";
import { visualRectOf } from "../util/layout/geometry";
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

  // spacing: draw the two gaps it claims are equal
  const ordered = [...refs].sort((a, b) => startOf(a, axis) - startOf(b, axis));
  const [first, second] = ordered;
  if (!second) return [];

  const draggedAfter = startOf(ghost, axis) >= endOf(second, axis);
  const draggedBefore = endOf(ghost, axis) <= startOf(first, axis);

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

  // centred between the refs: the gap on either side of it
  if (!draggedAfter && !draggedBefore)
    return [
      seg(endOf(first, axis), startOf(ghost, axis), "first"),
      seg(endOf(ghost, axis), startOf(second, axis), "second"),
    ];

  // past either end of them: their own gap, and the matching one between the
  // nearer ref and where the dragged node would land
  return [
    seg(endOf(first, axis), startOf(second, axis), "existing"),
    draggedAfter
      ? seg(endOf(second, axis), startOf(ghost, axis), "new")
      : seg(endOf(ghost, axis), startOf(first, axis), "new"),
  ];
};

/**
 * Computes alignment and equal-spacing guides while a node is dragged, and --
 * when magnetic alignment is on -- pulls the node onto them. When a selection
 * is dragged, the node under the pointer is the one guided, and the rest of
 * the selection follows it.
 *
 * Guides are returned as plain geometry for an overlay to draw, rather than
 * being synthesised as React Flow edges the way they used to be, which forced
 * every consumer of the edge list to know to skip them.
 */
export const useAlignmentGuide = () => {
  const { getNodes, setNodes } = useReactFlow();
  const { settings } = useDiagramSettings();
  const [guides, setGuides] = useState<GuideLine[]>([]);
  const draggingRef = useRef<string | null>(null);
  /**
   * Where the shape actually ended up last frame, in the coordinates collision
   * works in. Collision has to know which way the shape came from to tell which
   * side of an obstacle it ran into, and React Flow re-derives the position
   * from the pointer every frame, so the pointer alone cannot say.
   */
  const lastFreeRef = useRef<{ x: number; y: number } | null>(null);

  /**
   * React Flow hands both handlers no node at all when the one pressed is not
   * itself dragged: a node whose parent is selected moves with the parent --
   * an attribute of a selected entity, a member of a selected box -- and the
   * pressed node is left out of the drag (getDragItems). There is then no
   * dragged node to guide.
   */
  const onNodeDragStart: NodeDragHandler = useCallback(
    (_evt, node: Node | undefined) => {
      draggingRef.current = node?.id ?? null;
      lastFreeRef.current = null;
    },
    [],
  );

  const onNodeDrag: NodeDragHandler = useCallback(
    (_evt, node: Node | undefined, draggedNodes: Node[]) => {
      if (node === undefined) return;
      // what the pointer carries: the node under it, and the rest of the
      // selection when there is one (React Flow lists the node among them)
      const dragged = new Map(
        [node, ...(draggedNodes ?? [])].map((n) => [n.id, n]),
      );
      const allNodes = getNodes();
      // the store lags the pointer by a frame during a drag, so trust the
      // positions React Flow just handed us
      const live = allNodes.map((n) => {
        const moved = dragged.get(n.id);
        return moved === undefined ? n : { ...n, position: moved.position };
      });

      const draggedIsStructural = STRUCTURAL_TYPES.includes(node.type ?? "");
      // Resolved against the whole list, and filtered afterwards. A node inside
      // an aggregation stores its position relative to the container, so its
      // absolute rectangle can only be worked out with the container present --
      // hand toAbsoluteRects a list with the parent missing and it silently
      // returns the relative position, which then gets compared against
      // everyone else's absolute one.
      const draggedRect = absoluteRectOf(live, node.id);
      if (!draggedRect) return;

      // Whatever the drag carries along -- the rest of a selection, the members
      // of a dragged box -- keeps its place relative to the node, so it says
      // nothing about where to drop it. Left in, a selection would guide the
      // node against itself all drag long, from where the store last had it.
      const moved = movedByDrag(live, [...dragged.keys()]);
      // aligning an entity against attribute ovals is noise; aligning an
      // attribute against its siblings is not
      const others = toAbsoluteRects(live, {
        structuralOnly: draggedIsStructural,
      }).filter((rect) => !moved.has(rect.id));
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

      // `draggedRect` is absolute; `node.position` is relative to the parent
      // for child nodes, so carry the difference across
      const offsetX = draggedRect.x - node.position.x;
      const offsetY = draggedRect.y - node.position.y;

      let corrected = { x: draggedRect.x, y: draggedRect.y };

      // Magnetic alignment: pull the node onto the candidates it is close to.
      // In a group it is the node under the pointer that snaps, and the rest
      // of the selection takes the same shift (below): the group lands where
      // that node does, and is never torn apart.
      if (settings.snapEnabled && active.length > 0) {
        for (const candidate of active) {
          if (candidate.axis === "x")
            corrected.x = candidate.value - draggedRect.width / 2;
          else corrected.y = candidate.value - draggedRect.height / 2;
        }
      }

      // Collision: keep the shape out of the ones it does not belong to. After
      // the snap, so a magnet can never pull a shape into an overlap. Not for
      // a group: only the shape under the pointer is measured, so stopping it
      // at a wall would say nothing about what the rest of the selection runs
      // into.
      const isMultiDrag = dragged.size > 1;
      if (settings.collisionEnabled && !isMultiDrag) {
        // measured by what each shape covers on screen, so a diamond collides
        // where it is drawn rather than at the box React Flow measured
        const visual = visualRectOf(
          node.id,
          node.type ?? "",
          corrected,
          draggedRect.width,
          draggedRect.height,
        );
        const from = lastFreeRef.current ?? { x: visual.x, y: visual.y };
        const free = slideOutOfCollisions(
          visual,
          from,
          obstaclesFor(live, node.id),
        );
        // the visual box shares its centre with the measured one, so a shift of
        // the first is the same shift of the second
        corrected = {
          x: corrected.x + (free.x - visual.x),
          y: corrected.y + (free.y - visual.y),
        };
        lastFreeRef.current = free;
      }

      const next = { x: corrected.x - offsetX, y: corrected.y - offsetY };
      const shift = {
        x: next.x - node.position.x,
        y: next.y - node.position.y,
      };
      if (shift.x !== 0 || shift.y !== 0) {
        // React Flow re-derives the positions from the pointer on the next
        // move, so a snap reads as a magnet rather than a lock: drag far enough
        // and the node breaks free on its own. Collision re-applies every
        // frame, so it reads as a wall instead. Nodes with extent "parent"
        // (aggregation members) still get clamped to the box by React Flow.
        // Every node the pointer carries takes the shift, from the position
        // React Flow just gave it -- the store's is a frame behind.
        setNodes((nodes) =>
          nodes.map((n) => {
            const moved = dragged.get(n.id);
            return moved === undefined
              ? n
              : {
                  ...n,
                  position: {
                    x: moved.position.x + shift.x,
                    y: moved.position.y + shift.y,
                  },
                };
          }),
        );
      }

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
      setNodes,
      settings.snapEnabled,
      settings.snapRadius,
      settings.spacingGuidesEnabled,
      settings.collisionEnabled,
    ],
  );

  const onNodeDragStop: NodeDragHandler = useCallback(() => {
    draggingRef.current = null;
    setGuides([]);
  }, []);

  return { onNodeDragStart, onNodeDrag, onNodeDragStop, guides };
};
