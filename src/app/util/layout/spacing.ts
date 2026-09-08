/**
 * Step 6b: open the gaps between the rows and columns the arrangement produced,
 * until what is drawn actually fits between them.
 *
 * The search answers two questions with one number. *Where does this go* --
 * which side of the diagram, above or below what, in line with what -- and *how
 * far away does it go*. Both are decided by the same cost, so anything that
 * changes how much room an element needs also changes where every other element
 * ends up: add a field to an entity and the diagram reshuffles, hide the
 * attributes and it reshuffles back, even though no entity and no relationship
 * moved.
 *
 * This pass separates them. The arrangement is left exactly as it was found and
 * only the distances are recomputed, from whatever is on screen right now.
 *
 * What makes that cheap is the constraint the search already works under: a
 * position is always a whole number of grid steps from an anchor, and the
 * anchor chain reaches the seed at the origin, so every centre falls on one of a
 * small set of x values and y values. Call those **lines**. Spacing is then
 * nothing more than widening the gaps between consecutive lines.
 *
 * **Why that cannot disturb the arrangement.** The result is a single-valued,
 * strictly increasing function of the coordinate, applied identically to
 * everything on a line. Single-valued gives `same line -> same line`; strictly
 * increasing gives `different line -> different line`, in the same order. The
 * exact-equality test the whole alignment constraint rests on returns the same
 * answers before and after, and no element can pass another. The diagram can
 * only breathe in and out.
 */

import { Rect, overlapsOnCrossAxis } from "../alignmentCandidates";
import { rectAt } from "./geometry";
import { LayoutParams } from "./params";
import { LayoutElement, LayoutGraph, Placement, Vec } from "./types";

type Axis = "x" | "y";

const AXES: Axis[] = ["x", "y"];

/** A gap short of what it owes by less than this is not short of anything. */
const EPSILON = 1e-6;

/**
 * A monotone coordinate transform along one axis: exact on the lines it was
 * built from, linearly interpolated between them, a plain translation outside.
 *
 * `from` is ascending and `to` is the same length. Interpolation is what lets
 * the map be applied to something that is not on a line itself -- an ISA
 * triangle seated between two rows keeps its share of the row it sits in.
 */
export type AxisSpacing = { from: number[]; to: number[] };

export type Spacing = { x: AxisSpacing; y: AxisSpacing };

export const IDENTITY_SPACING: Spacing = {
  x: { from: [], to: [] },
  y: { from: [], to: [] },
};

export const remap = ({ from, to }: AxisSpacing, value: number): number => {
  if (from.length === 0) return value;
  if (value <= from[0]) return value + (to[0] - from[0]);
  const last = from.length - 1;
  if (value >= from[last]) return value + (to[last] - from[last]);

  let index = 0;
  while (index < last && from[index + 1] < value) index++;
  // exactly, for a value that is itself a line, and for anything between two
  // lines that did not move. Interpolating those would run them through a
  // division and a multiplication that do not have to come back to where they
  // started, and every element on an untouched part of the diagram would drift
  // by a fraction of a pixel.
  if (value === from[index]) return to[index];
  if (value === from[index + 1]) return to[index + 1];
  if (to[index] === from[index] && to[index + 1] === from[index + 1])
    return value;

  const span = from[index + 1] - from[index];
  const fraction = span === 0 ? 0 : (value - from[index]) / span;
  return to[index] + fraction * (to[index + 1] - to[index]);
};

/**
 * A `SkeletonElement.footprint` carried through the same transform.
 *
 * The box is stored relative to its owner's centre, so it is resolved to
 * absolute corners, mapped, and re-expressed against the owner's new centre.
 */
export const remapFootprint = (
  spacing: Spacing,
  footprint: { dx: number; dy: number; width: number; height: number },
  before: Vec,
  after: Vec,
) => {
  const left = remap(spacing.x, before.x + footprint.dx - footprint.width / 2);
  const right = remap(spacing.x, before.x + footprint.dx + footprint.width / 2);
  const top = remap(spacing.y, before.y + footprint.dy - footprint.height / 2);
  const bottom = remap(
    spacing.y,
    before.y + footprint.dy + footprint.height / 2,
  );
  return {
    dx: (left + right) / 2 - after.x,
    dy: (top + bottom) / 2 - after.y,
    width: right - left,
    height: bottom - top,
  };
};

export const applySpacing = (spacing: Spacing, centres: Placement): Placement =>
  new Map(
    [...centres].map(([id, centre]) => [
      id,
      { x: remap(spacing.x, centre.x), y: remap(spacing.y, centre.y) },
    ]),
  );

/**
 * What the element itself covers: the box the arrangement was decided from.
 *
 * A tree root's `footprint` is deliberately not consulted. It is a device for
 * finding the whole tree a spot while its members have no position of their own;
 * by the time this runs they are placed, and every one of them is on this list
 * in its own right. Reserving the tree box as well would have a root demand room
 * from its own children.
 */
const bareRect = (element: LayoutElement, centre: Vec): Rect =>
  rectAt(element.id, centre, element.visualWidth, element.visualHeight);

/** ...and how far its attribute ring reaches past that box. */
const ringOf = (element: LayoutElement, params: LayoutParams) =>
  element.haloRadius * params.haloFactor;

/** One element, reduced to what spacing needs to know about it. */
type Spaced = {
  id: string;
  /** its centre on the axis being solved */
  line: number;
  bare: Rect;
  ring: number;
};

const sizeOn = (rect: Rect, axis: Axis) =>
  axis === "x" ? rect.width : rect.height;

/**
 * Where each line on one axis ends up, given everything sitting on all of them.
 *
 * Two questions are asked of every pair, and answered from different boxes.
 * *Which axis has to keep them apart* is read off the bare boxes: that is a
 * property of the arrangement, and must not change with the view -- a pair that
 * shares a row is separated by x whatever rings they are wearing. *How far apart
 * they must be* is then measured with the rings, because that is what is drawn.
 * Asking the first question of the ringed boxes instead would let a pair sitting
 * diagonally from each other count as sharing both a row and a column, and be
 * pushed apart twice over.
 */
const solveAxis = (
  axis: Axis,
  elements: Spaced[],
  joined: (a: string, b: string) => boolean,
  params: LayoutParams,
): AxisSpacing => {
  const from = [...new Set(elements.map((element) => element.line))].sort(
    (a, b) => a - b,
  );
  const indexOf = new Map(from.map((line, index) => [line, index]));

  // per line, what an earlier line owes it: `{ index, need }` centre to centre
  const demands: { index: number; need: number }[][] = from.map(() => []);
  for (const a of elements)
    for (const b of elements) {
      const before = indexOf.get(a.line)!;
      const after = indexOf.get(b.line)!;
      if (before >= after) continue;
      if (!overlapsOnCrossAxis(a.bare, b.bare, axis)) continue;
      // ...but an element joined to whatever is across the gap wears no ring
      // there: `placeAttributes` fans into the sectors an owner's edges leave
      // free, so the one direction a ring is never in is the direction of a line
      // out of it. Demanding room for it between two things that are wired
      // together reserves space for something that is not drawn.
      const ring = joined(a.id, b.id) ? 0 : a.ring + b.ring;
      demands[after].push({
        index: before,
        need:
          (sizeOn(a.bare, axis) + sizeOn(b.bare, axis)) / 2 +
          ring +
          params.minSeparation,
      });
    }

  // one forward pass is enough: every constraint points from a lower line to a
  // higher one, and the lines are settled in ascending order
  const shift = from.map(() => 0);
  for (let index = 1; index < from.length; index++) {
    shift[index] = shift[index - 1];
    let deficit = 0;
    for (const demand of demands[index]) {
      const gap =
        from[index] + shift[index] - (from[demand.index] + shift[demand.index]);
      deficit = Math.max(deficit, demand.need - gap);
    }
    // widening by a whole number of grid steps keeps every centre exactly as
    // on-grid as it was, and leaves `shift` untouched at zero when nothing binds
    if (deficit > EPSILON)
      shift[index] += Math.ceil(deficit / params.gridStep) * params.gridStep;
  }

  return { from, to: from.map((line, index) => line + shift[index]) };
};

/** Does this axis map anything anywhere? */
const moves = ({ from, to }: AxisSpacing) =>
  from.some((line, index) => to[index] !== line);

/**
 * The transform to apply to a finished arrangement.
 *
 * Built from the skeleton alone: those are the elements whose centres define the
 * lines. Everything else -- diamonds, triangles, attributes -- is placed
 * relative to them afterwards, or carried along by `applySpacing`.
 */
export const spacingFor = (
  graph: LayoutGraph,
  centres: Placement,
  params: LayoutParams,
): Spacing => {
  if (!params.spacing.enabled) return IDENTITY_SPACING;

  const placed: { element: LayoutElement; centre: Vec }[] = [];
  for (const element of graph.skeleton) {
    const centre = centres.get(element.id);
    if (centre !== undefined) placed.push({ element, centre });
  }
  if (placed.length === 0) return IDENTITY_SPACING;

  const wired = new Set<string>();
  for (const [id, neighbours] of graph.wiring)
    for (const neighbourId of neighbours)
      wired.add([id, neighbourId].sort().join("|"));
  const joined = (a: string, b: string) => wired.has([a, b].sort().join("|"));

  const [x, y] = AXES.map((axis) =>
    solveAxis(
      axis,
      placed.map(({ element, centre }) => ({
        id: element.id,
        line: axis === "x" ? centre.x : centre.y,
        bare: bareRect(element, centre),
        ring: ringOf(element, params),
      })),
      joined,
      params,
    ),
  );

  // an arrangement that already has the room it needs is left strictly alone,
  // rather than passed through a transform that happens to be the identity
  return moves(x) || moves(y) ? { x, y } : IDENTITY_SPACING;
};
