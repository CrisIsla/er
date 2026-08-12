/**
 * Pure geometry for the manual-editing guides.
 *
 * Deliberately free of React Flow (and React) types: it works on plain
 * rectangles so it can be unit tested directly, and so it survives if the
 * rendering library is ever swapped. Stage 4's magnetic alignment consumes the
 * same candidates that Stage 3 draws.
 */

export type Rect = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};

/** Minimal shape of a React Flow node, structurally compatible without importing it. */
export type PositionedNode = {
  id: string;
  type?: string;
  position: { x: number; y: number };
  width?: number | null;
  height?: number | null;
  parentNode?: string;
  hidden?: boolean;
};

export type Axis = "x" | "y";

/**
 * A position the dragged rectangle's centre could take on one axis.
 * `align` means "share a centre line with the referenced nodes";
 * `spacing` means "sit at the same gap as an existing pair".
 */
export type Candidate = {
  axis: Axis;
  /** target centre coordinate on `axis` */
  value: number;
  kind: "align" | "spacing";
  /** nodes that justify this candidate, for drawing and debugging */
  refIds: string[];
  /** edge-to-edge gap being matched (spacing only) */
  gap?: number;
};

/** Node types that make up the diagram skeleton. Attributes are childed to
 * their owner and move with it, so they are noise when aligning. */
const STRUCTURAL_TYPES = ["entity", "relationship", "isA", "aggregation"];

const centerOf = (rect: Rect, axis: Axis) =>
  axis === "x" ? rect.x + rect.width / 2 : rect.y + rect.height / 2;

const sizeOf = (rect: Rect, axis: Axis) =>
  axis === "x" ? rect.width : rect.height;

const startOf = (rect: Rect, axis: Axis) => (axis === "x" ? rect.x : rect.y);

const endOf = (rect: Rect, axis: Axis) =>
  startOf(rect, axis) + sizeOf(rect, axis);

/** Do two rects overlap on the axis perpendicular to `axis`? Used to decide
 * whether they sit in the same visual row (for "x") or column (for "y"). */
const overlapsOnCrossAxis = (a: Rect, b: Rect, axis: Axis) => {
  const cross: Axis = axis === "x" ? "y" : "x";
  return (
    startOf(a, cross) < endOf(b, cross) && startOf(b, cross) < endOf(a, cross)
  );
};

/**
 * Resolves nodes to absolute rectangles, adding the parent offset for child
 * nodes (attributes, aggregation members). Nodes without measured dimensions
 * or that are hidden are dropped -- guides must never point at something the
 * user cannot see.
 */
export const toAbsoluteRects = (
  nodes: PositionedNode[],
  { structuralOnly = true }: { structuralOnly?: boolean } = {},
): Rect[] => {
  const byId = new Map(nodes.map((node) => [node.id, node]));

  return nodes
    .filter((node) => !node.hidden && node.width && node.height)
    .filter(
      (node) => !structuralOnly || STRUCTURAL_TYPES.includes(node.type ?? ""),
    )
    .map((node) => {
      let { x, y } = node.position;
      // one level of nesting is all the diagram produces today, but walk the
      // chain anyway so deeper nesting doesn't silently misplace guides
      let parentId = node.parentNode;
      const seen = new Set<string>([node.id]);
      while (parentId && !seen.has(parentId)) {
        seen.add(parentId);
        const parent = byId.get(parentId);
        if (!parent) break;
        x += parent.position.x;
        y += parent.position.y;
        parentId = parent.parentNode;
      }
      return { id: node.id, x, y, width: node.width!, height: node.height! };
    });
};

/** Centre-line alignment: the dragged rect shares a centre with another rect. */
export const getAlignCandidates = (
  dragged: Rect,
  others: Rect[],
): Candidate[] => {
  const candidates: Candidate[] = [];
  for (const axis of ["x", "y"] as const) {
    // group by coordinate so several nodes on the same line yield one candidate
    const byValue = new Map<number, string[]>();
    for (const other of others) {
      const value = centerOf(other, axis);
      const key = Math.round(value * 100) / 100;
      byValue.set(key, [...(byValue.get(key) ?? []), other.id]);
    }
    for (const [value, refIds] of byValue) {
      candidates.push({ axis, value, kind: "align", refIds });
    }
  }
  return candidates;
};

/**
 * Equal-spacing: given two rects already separated by a gap on `axis`, propose
 * positions where the dragged rect continues the run with the same gap --
 * either after the second or before the first.
 *
 * Only pairs that overlap on the perpendicular axis are considered, so a node
 * far above doesn't produce a horizontal spacing guide.
 */
export const getSpacingCandidates = (
  dragged: Rect,
  others: Rect[],
): Candidate[] => {
  const candidates: Candidate[] = [];

  for (const axis of ["x", "y"] as const) {
    // only rects sharing a row (axis "x") or column (axis "y") with the dragged one
    const inLine = others
      .filter((other) => overlapsOnCrossAxis(dragged, other, axis))
      .sort((a, b) => startOf(a, axis) - startOf(b, axis));

    for (let i = 0; i < inLine.length - 1; i++) {
      const first = inLine[i];
      const second = inLine[i + 1];
      const gap = startOf(second, axis) - endOf(first, axis);
      if (gap <= 0) continue; // overlapping or touching: no meaningful spacing

      const half = sizeOf(dragged, axis) / 2;
      // continue the run after `second`
      candidates.push({
        axis,
        value: endOf(second, axis) + gap + half,
        kind: "spacing",
        refIds: [first.id, second.id],
        gap,
      });
      // ...or before `first`
      candidates.push({
        axis,
        value: startOf(first, axis) - gap - half,
        kind: "spacing",
        refIds: [first.id, second.id],
        gap,
      });
    }
  }

  return candidates;
};

export const getCandidates = (
  dragged: Rect,
  others: Rect[],
  { includeSpacing = true }: { includeSpacing?: boolean } = {},
): Candidate[] => [
  ...getAlignCandidates(dragged, others),
  ...(includeSpacing ? getSpacingCandidates(dragged, others) : []),
];

/** Distance from the dragged rect's current centre to a candidate. */
export const distanceTo = (dragged: Rect, candidate: Candidate) =>
  Math.abs(centerOf(dragged, candidate.axis) - candidate.value);

/**
 * Candidates within `tolerance` of the dragged rect, nearest first, keeping at
 * most one per axis. Stage 3 calls this with a small tolerance to decide which
 * guides to draw; Stage 4 will call it with the configurable snap radius.
 */
export const findActiveCandidates = (
  dragged: Rect,
  others: Rect[],
  tolerance: number,
  options?: { includeSpacing?: boolean },
): Candidate[] => {
  const withinTolerance = getCandidates(dragged, others, options)
    .map((candidate) => ({ candidate, dist: distanceTo(dragged, candidate) }))
    .filter(({ dist }) => dist <= tolerance)
    .sort((a, b) => a.dist - b.dist);

  const perAxis = new Map<Axis, Candidate>();
  for (const { candidate } of withinTolerance) {
    // alignment wins ties against spacing at equal distance, since a shared
    // centre line is the stronger visual claim
    if (!perAxis.has(candidate.axis)) perAxis.set(candidate.axis, candidate);
  }
  return Array.from(perAxis.values());
};

export { centerOf, sizeOf, startOf, endOf, STRUCTURAL_TYPES };
