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
 * nothing more than resizing the gaps between consecutive lines.
 *
 * It goes both ways. A gap that is short of what is drawn opens; a gap holding
 * room for a ring that is *not* drawn -- attributes the reader has hidden --
 * gives exactly that much back, and no more. Which is what makes hiding the
 * attributes draw the same diagram tighter rather than a different diagram.
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
import { TreeLayout } from "./hierarchy";
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
 * `from` is ascending and `to` is the same length. Interpolation is what makes
 * it total: anything that is not on a line of its own keeps its share of the gap
 * it sits in, so the map can be applied to a whole placement without first
 * asking which of its points defined the lattice.
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

export const applySpacing = (spacing: Spacing, centres: Placement): Placement =>
  new Map(
    [...centres].map(([id, centre]) => [
      id,
      { x: remap(spacing.x, centre.x), y: remap(spacing.y, centre.y) },
    ]),
  );

/** What the element itself covers: the box the arrangement was decided from. */
const bareRect = (element: LayoutElement, centre: Vec): Rect =>
  rectAt(element.id, centre, element.visualWidth, element.visualHeight);

/**
 * ...and how far its attribute ring reaches past that box.
 *
 * `drawnHalo`, not `haloRadius`: the point of this pass is to make room for what
 * is on screen, and when the arrangement was made attribute-blind the other one
 * is zero. Only `haloFactor` of it, because attributes are steered into
 * whichever sector around their owner is free, so reserving the whole ring in
 * every direction would spread the diagram out far more than it needs.
 */
const ringOf = (element: LayoutElement, params: LayoutParams) => ({
  drawn: element.drawnHalo * params.haloFactor,
  // ...and how much room the arranging stage set aside for one, which is not the
  // same number: it counts every attribute the element owns, drawn or not, so
  // that what it decides does not depend on the view
  reserved: element.haloRadius * params.haloFactor,
});

/**
 * One element, reduced to what spacing needs to know about it.
 *
 * `centre` is the line it rides on, which is not always its own: every member of
 * an ISA hierarchy rides on its root's. The tree was arranged to be read as a
 * tree -- parents centred over evenly spaced children -- and widening the
 * individual lines its members happen to sit on would take that apart, so the
 * whole of it moves as one. `bare` is still each member's own box, where it
 * really is, so the room the tree needs from its neighbours is measured against
 * what it actually covers rather than the empty rectangle around it.
 */
type Spaced = {
  id: string;
  centre: Vec;
  bare: Rect;
  /** how far its ring reaches past `bare`, and how much room was set aside */
  ring: { drawn: number; reserved: number };
};

/**
 * One line owes another this much room, centre to centre -- `need` for what is
 * drawn, `reserved` for what the arrangement set aside. The difference between
 * them is the room being held for a ring nobody can see, which is what a gap may
 * give back.
 */
type Demand = { from: number; to: number; need: number; reserved: number };

const sizeOn = (rect: Rect, axis: Axis) =>
  axis === "x" ? rect.width : rect.height;

/** How far an element's box sits from the element's own centre, on one axis. */
const offsetOn = ({ bare, centre }: Spaced, axis: Axis) =>
  (axis === "x" ? bare.x + bare.width / 2 : bare.y + bare.height / 2) -
  centre[axis];

/**
 * What every pair of elements asks of the axis that has to keep them apart.
 *
 * Two questions, answered from different boxes. *Which axis has to keep them
 * apart* is read off the bare boxes: that is a property of the arrangement and
 * must not change with the view -- a pair that shares a row is separated by x
 * whatever rings they are wearing. *How far apart they must be* is then measured
 * with the rings, because that is what is drawn.
 *
 * Asking the first question of the ringed boxes too would let a pair sitting
 * diagonally from each other count as sharing both a row and a column, and be
 * pushed apart twice over. But a diagonal pair whose rings do overlap has to be
 * pushed apart *somehow*, and there the arrangement has no opinion: the demand
 * goes to whichever axis is closer to satisfying it already, which is the one
 * that moves the diagram least.
 */
const collectDemands = (
  elements: Spaced[],
  lineIndex: { x: Map<number, number>; y: Map<number, number> },
  joined: (a: Spaced, b: Spaced) => boolean,
  params: LayoutParams,
) => {
  const demands: Record<Axis, Demand[]> = { x: [], y: [] };

  for (let i = 0; i < elements.length; i++)
    for (let j = i + 1; j < elements.length; j++) {
      const a = elements[i];
      const b = elements[j];
      // an element joined to whatever is across the gap wears no ring there:
      // `placeAttributes` fans into the sectors an owner's edges leave free, so
      // the one direction a ring is never in is the direction of a line out of
      // it. Reserving room for it between two things that are wired together
      // makes space for something nobody draws.
      const wired = joined(a, b);

      const shortfall = {} as Record<Axis, number>;
      const claim = {} as Record<Axis, Demand | null>;
      for (const axis of AXES) {
        const first = a.centre[axis] <= b.centre[axis] ? a : b;
        const second = first === a ? b : a;
        // centre to centre, which is not box to box: a hierarchy member's box
        // is nowhere near the root's line it rides on, so how far each box sits
        // from its own line has to come back out of the distance demanded
        const between =
          (sizeOn(first.bare, axis) + sizeOn(second.bare, axis)) / 2 +
          offsetOn(first, axis) -
          offsetOn(second, axis) +
          params.minSeparation;
        const rings = wired
          ? { drawn: 0, reserved: 0 }
          : {
              drawn: first.ring.drawn + second.ring.drawn,
              reserved: first.ring.reserved + second.ring.reserved,
            };
        const from = lineIndex[axis].get(first.centre[axis])!;
        const to = lineIndex[axis].get(second.centre[axis])!;
        // the ring the arrangement never saw, which is nothing at all unless it
        // was made attribute-blind
        const unreserved = Math.max(0, rings.drawn - rings.reserved);
        shortfall[axis] =
          between + unreserved - (second.centre[axis] - first.centre[axis]);
        claim[axis] =
          from === to
            ? null
            : {
                from,
                to,
                need: between + rings.drawn,
                reserved: between + rings.reserved,
              };
      }

      // the bare boxes say which axis is the only one that can separate them
      const mandatory = AXES.filter((axis) =>
        overlapsOnCrossAxis(a.bare, b.bare, axis),
      );
      if (mandatory.length > 0) {
        for (const axis of mandatory) {
          const demand = claim[axis];
          if (demand !== null) demands[axis].push(demand);
        }
        continue;
      }

      // ...and when neither is, only a pair that is short on *both* axes needs
      // anything at all -- being clear on one is being clear.
      //
      // Short by the part of the ring the *arrangement* never saw, not by the
      // whole of it. A sighted arrangement already refused to put two ringed
      // boxes within a minimum of each other on both axes at once, so there is
      // nothing here to make up; a blind one reserved no ring anywhere, and
      // every diagonal pair of it has to be checked.
      if (shortfall.x <= EPSILON || shortfall.y <= EPSILON) continue;
      const axis = shortfall.x <= shortfall.y ? "x" : "y";
      const demand = claim[axis];
      if (demand !== null) demands[axis].push(demand);
    }

  return demands;
};

/**
 * Where each line on one axis ends up, given what is owed across it.
 *
 * One forward pass is enough: every demand points from a lower line to a higher
 * one, and the lines are settled in ascending order.
 *
 * A line moves for one of two reasons, and the two are the same arithmetic. It
 * is *short* of what is drawn -- the arrangement was made blind to the rings, or
 * the refinement gave a little of the clearance back -- and opens up. Or it is
 * holding room the arrangement set aside for a ring that turns out not to be
 * drawn, and gives back exactly that much: no more, so a gap that was generous
 * for reasons of its own stays generous, and a view with nothing hidden does not
 * move at all.
 */
const solveAxis = (
  from: number[],
  demands: Demand[],
  params: LayoutParams,
): AxisSpacing => {
  const owed: Demand[][] = from.map(() => []);
  for (const demand of demands) owed[demand.to].push(demand);

  const shift = from.map(() => 0);
  for (let index = 1; index < from.length; index++) {
    shift[index] = shift[index - 1];
    const here = from[index] + shift[index];

    // the nearest this line may come to the ones behind it -- measured against
    // what is drawn, and against what was set aside for it
    let leastDrawn = -Infinity;
    let leastReserved = -Infinity;
    for (const demand of owed[index]) {
      const behind = from[demand.from] + shift[demand.from];
      leastDrawn = Math.max(leastDrawn, behind + demand.need);
      leastReserved = Math.max(leastReserved, behind + demand.reserved);
    }

    const spare = Math.max(0, leastReserved - leastDrawn);
    // lines may close up but never meet: one step apart is the least that keeps
    // them distinct, which is what `same line` and `different line` rest on
    const apart = from[index - 1] + shift[index - 1] + params.gridStep;
    const target = Math.max(leastDrawn, apart, here - spare);

    // ...and it moves by a whole number of grid steps, so every centre stays
    // exactly as on-grid as it was. Rounding up rather than to nearest, so a
    // line that gives room back never gives back more than it had spare.
    const delta = target - here;
    if (Math.abs(delta) > EPSILON)
      shift[index] +=
        Math.ceil(delta / params.gridStep - EPSILON) * params.gridStep;
  }

  return { from, to: from.map((line, index) => line + shift[index]) };
};

/** Does this axis map anything anywhere? */
const moves = ({ from, to }: AxisSpacing) =>
  from.some((line, index) => to[index] !== line);

export type SpacingOptions = {
  /**
   * ISA hierarchies, so their members can be gathered onto their root's line.
   *
   * A tree stays rigid here. It was arranged to be read as a tree -- parents
   * centred over evenly spaced children -- and that is a property of the whole
   * shape, not of any one gap in it: widen the lines its members happen to sit
   * on by different amounts and the fan comes apart. So the tree asks for room
   * as one, member by member, and moves as one.
   */
  trees?: TreeLayout[];
};

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
  { trees = [] }: SpacingOptions = {},
): Spacing => {
  if (!params.spacing.enabled) return IDENTITY_SPACING;

  // member -> the root whose line it rides on
  const ridesOn = new Map<string, string>();
  for (const tree of trees)
    for (const id of tree.offsets.keys()) ridesOn.set(id, tree.rootId);

  const wired = new Set<string>();
  for (const [id, neighbours] of graph.wiring)
    for (const neighbourId of neighbours)
      wired.add([id, neighbourId].sort().join("|"));

  const elements: Spaced[] = [];
  for (const element of graph.skeleton) {
    const centre = centres.get(element.id);
    if (centre === undefined) continue;
    const line = centres.get(ridesOn.get(element.id) ?? element.id);
    if (line === undefined) continue;
    elements.push({
      id: element.id,
      centre: line,
      bare: bareRect(element, centre),
      ring: ringOf(element, params),
    });
  }
  if (elements.length === 0) return IDENTITY_SPACING;

  const lines = {
    x: [...new Set(elements.map((item) => item.centre.x))].sort(
      (a, b) => a - b,
    ),
    y: [...new Set(elements.map((item) => item.centre.y))].sort(
      (a, b) => a - b,
    ),
  };
  const lineIndex = {
    x: new Map(lines.x.map((line, index) => [line, index])),
    y: new Map(lines.y.map((line, index) => [line, index])),
  };

  const joined = (a: Spaced, b: Spaced) =>
    wired.has([a.id, b.id].sort().join("|"));

  const demands = collectDemands(elements, lineIndex, joined, params);
  const x = solveAxis(lines.x, demands.x, params);
  const y = solveAxis(lines.y, demands.y, params);

  // an arrangement that already has the room it needs is left strictly alone,
  // rather than passed through a transform that happens to be the identity
  return moves(x) || moves(y) ? { x, y } : IDENTITY_SPACING;
};
