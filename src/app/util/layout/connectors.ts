/**
 * Step 4 of Algorithm 1: drop the relationship diamonds and ISA triangles onto
 * the skeleton the search has already placed.
 *
 * A connector goes at the centroid of what it joins. Three cases need more than
 * that:
 *  - several relationships joining the same elements would land on the same
 *    point, so they are spread symmetrically along the perpendicular;
 *  - a recursive relationship reaches one entity through two roles, so its
 *    centroid *is* that entity and it has to become a satellite instead;
 *  - a centroid can simply land on top of something, most easily on the middle
 *    participant of a ternary relationship.
 */

import { Rect } from "../alignmentCandidates";
import {
  DIRECTIONS,
  angleOf,
  centroid,
  normalizeAngle,
  rectAt,
  rectsOverlap,
  snapVec,
  TAU,
} from "./geometry";
import { LayoutParams } from "./params";
import { clearanceRect } from "./placement";
import {
  ConnectorElement,
  LayoutElement,
  LayoutGraph,
  Placement,
  Vec,
} from "./types";

/**
 * Cardinal directions only, for the self-loop satellite.
 *
 * useEdgePath picks which side of a node an edge leaves from by comparing |dx|
 * against |dy|, so a diagonal placement is a near-tie that flips sides under a
 * pixel of movement. A cardinal offset gives the two role edges two stable,
 * distinct handles.
 */
const CARDINALS: Vec[] = [
  { x: 1, y: 0 },
  { x: -1, y: 0 },
  { x: 0, y: 1 },
  { x: 0, y: -1 },
];

/** How far a box reaches from its centre in the direction `angle`. */
export const supportRadius = (width: number, height: number, angle: number) =>
  Math.abs(Math.cos(angle)) * (width / 2) +
  Math.abs(Math.sin(angle)) * (height / 2);

/** Directions in which an element already has something attached. */
const occupiedAngles = (
  elementId: string,
  centres: Placement,
  graph: LayoutGraph,
) => {
  const centre = centres.get(elementId);
  if (centre === undefined) return [];
  const angles: number[] = [];
  for (const neighbourId of graph.neighbours.get(elementId) ?? []) {
    const neighbourCentre = centres.get(neighbourId);
    if (neighbourCentre !== undefined)
      angles.push(angleOf(centre, neighbourCentre));
  }
  return angles;
};

/** The cardinal direction furthest from everything already attached. */
const freestCardinal = (occupied: number[]) => {
  if (occupied.length === 0) return CARDINALS[0];
  const clearance = (direction: Vec) => {
    const angle = normalizeAngle(Math.atan2(direction.y, direction.x));
    return Math.min(
      ...occupied.map((other) => {
        const difference = Math.abs(normalizeAngle(angle - other));
        return Math.min(difference, TAU - difference);
      }),
    );
  };
  return CARDINALS.reduce((best, direction) =>
    clearance(direction) > clearance(best) ? direction : best,
  );
};

/**
 * Nearest free position to `preferred`, searched outwards on the grid.
 *
 * Used as the fallback whenever a centroid is already taken -- the middle
 * participant of a ternary relationship, or two ISA triangles hanging off the
 * same superclass.
 */
export const findFreeSpot = (
  element: LayoutElement,
  preferred: Vec,
  occupied: Rect[],
  params: LayoutParams,
): Vec => {
  const fits = (candidate: Vec) => {
    const rect = rectAt(
      element.id,
      candidate,
      element.visualWidth,
      element.visualHeight,
    );
    return !occupied.some((other) => rectsOverlap(rect, other));
  };

  if (fits(preferred)) return preferred;

  const step = params.gridStep;
  for (let k = 1; k <= params.relax.maxStepsCeiling; k++)
    for (const direction of DIRECTIONS) {
      const candidate = {
        x: preferred.x + k * step * direction.x,
        y: preferred.y + k * step * direction.y,
      };
      if (fits(candidate)) return candidate;
    }
  return preferred;
};

/**
 * The point that leaves the largest gap as small as it can be.
 *
 * A centroid balances the distances between *centres*, which is not the same as
 * balancing the gaps between *shapes* once the shapes differ in size -- and for
 * three or more participants it is not even close. A ternary relationship whose
 * participants sit at 138, 378 and 798 has its centroid at 438, eight pixels
 * from the middle one and two hundred and forty from the far one.
 *
 * Each axis is solved on its own, because the gap between two boxes is the
 * larger of the two per-axis gaps and `max` commutes with itself. Along one
 * axis a participant demands `|v - c| - S`, so the whole set demands
 * `max(v - A, B - v)` with `A = min(c + S)` and `B = max(c - S)` -- smallest at
 * the midpoint of A and B.
 *
 * Two properties make this safe as a drop-in for the centroid: with two equal
 * participants it *is* the midpoint, so the common case does not move; and when
 * every participant shares a coordinate the answer is exactly that coordinate,
 * so an alignment the search worked for is never lost to rounding.
 */
export const gapCentre = (
  participants: { centre: Vec; width: number; height: number }[],
  connector: { width: number; height: number },
): Vec => {
  const along = (
    centreOf: (p: (typeof participants)[number]) => number,
    sizeOf: (p: (typeof participants)[number]) => number,
    connectorSize: number,
  ) => {
    let near = Infinity;
    let far = -Infinity;
    for (const participant of participants) {
      const reach = (connectorSize + sizeOf(participant)) / 2;
      near = Math.min(near, centreOf(participant) + reach);
      far = Math.max(far, centreOf(participant) - reach);
    }
    return (near + far) / 2;
  };

  return {
    x: along(
      (p) => p.centre.x,
      (p) => p.width,
      connector.width,
    ),
    y: along(
      (p) => p.centre.y,
      (p) => p.height,
      connector.height,
    ),
  };
};

/** Unit vector perpendicular to the line joining the first two participants. */
const perpendicularOf = (participants: string[], centres: Placement): Vec => {
  const first = centres.get(participants[0]);
  const second = centres.get(participants[1]);
  if (first === undefined || second === undefined) return { x: 0, y: 1 };
  const dx = second.x - first.x;
  const dy = second.y - first.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 0, y: 1 };
  return { x: -dy / length, y: dx / length };
};

export const placeConnectors = (
  graph: LayoutGraph,
  skeletonCentres: Placement,
  params: LayoutParams,
): Placement => {
  const centres: Placement = new Map();

  // everything the connectors have to stay off: the skeleton as placed, without
  // the attribute halo (attributes are fanned into the free sectors afterwards,
  // and they give way to the diagram's own structure)
  const occupied: Rect[] = [];
  for (const element of graph.skeleton) {
    const centre = skeletonCentres.get(element.id);
    if (centre !== undefined)
      occupied.push(clearanceRect(element, centre, params, 0));
  }

  const byGroup = new Map<string, ConnectorElement[]>();
  const ordered = [...graph.connectors].sort((a, b) =>
    a.key.localeCompare(b.key),
  );
  for (const connector of ordered)
    byGroup.set(connector.groupKey, [
      ...(byGroup.get(connector.groupKey) ?? []),
      connector,
    ]);

  const groupKeys = [...byGroup.keys()].sort();

  for (const groupKey of groupKeys) {
    const group = byGroup.get(groupKey)!;
    const { participants } = group[0];

    if (participants.length === 0) {
      // nothing to hang off; leave it at the origin rather than at NaN
      for (const connector of group) centres.set(connector.id, { x: 0, y: 0 });
      continue;
    }

    if (participants.length === 1) {
      // a recursive relationship: the centroid is the entity itself, so the
      // diamond becomes a satellite of it
      const ownerId = participants[0];
      const ownerCentre = skeletonCentres.get(ownerId);
      const owner = graph.elements.get(ownerId);
      if (ownerCentre === undefined || owner === undefined) {
        for (const connector of group)
          centres.set(connector.id, { x: 0, y: 0 });
        continue;
      }
      const taken = occupiedAngles(ownerId, skeletonCentres, graph);
      group.forEach((connector, index) => {
        const direction = freestCardinal([
          ...taken,
          ...group
            .slice(0, index)
            .map((placed) => angleOf(ownerCentre, centres.get(placed.id)!)),
        ]);
        const angle = normalizeAngle(Math.atan2(direction.y, direction.x));
        const distance =
          supportRadius(owner.visualWidth, owner.visualHeight, angle) +
          params.minSeparation +
          supportRadius(connector.visualWidth, connector.visualHeight, angle);
        const preferred = {
          x: ownerCentre.x + direction.x * distance,
          y: ownerCentre.y + direction.y * distance,
        };
        const spot = findFreeSpot(connector, preferred, occupied, params);
        centres.set(connector.id, spot);
        occupied.push(
          rectAt(
            connector.id,
            spot,
            connector.visualWidth,
            connector.visualHeight,
          ),
        );
      });
      continue;
    }

    const placedParticipants = participants
      .map((id) => ({
        centre: skeletonCentres.get(id),
        element: graph.elements.get(id),
      }))
      .filter(
        (p): p is { centre: Vec; element: LayoutElement } =>
          p.centre !== undefined && p.element !== undefined,
      )
      .map(({ centre, element }) => ({
        centre,
        width: element.visualWidth,
        height: element.visualHeight,
      }));

    const base =
      placedParticipants.length === 0
        ? centroid(
            participants
              .map((id) => skeletonCentres.get(id))
              .filter((centre): centre is Vec => centre !== undefined),
          )
        : gapCentre(placedParticipants, {
            width: group[0].visualWidth,
            height: group[0].visualHeight,
          });
    const normal = perpendicularOf(participants, skeletonCentres);
    const spread = params.parallelGap + group[0].visualWidth;

    group.forEach((connector, index) => {
      // symmetric about the line joining the participants: with two of them you
      // get the classic lens, with three the middle one stays on the line
      const offset = (index - (group.length - 1) / 2) * spread;
      const preferred = {
        x: base.x + normal.x * offset,
        y: base.y + normal.y * offset,
      };
      const spot = findFreeSpot(connector, preferred, occupied, params);
      centres.set(connector.id, spot);
      occupied.push(
        rectAt(
          connector.id,
          spot,
          connector.visualWidth,
          connector.visualHeight,
        ),
      );
    });
  }

  return centres;
};

export { CARDINALS, freestCardinal, occupiedAngles, snapVec };
