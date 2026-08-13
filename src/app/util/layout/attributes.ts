/**
 * Step 5 of Algorithm 1: fan the attributes out around their owner, into the
 * angular sectors its edges leave free.
 *
 * Composite attributes go one ring further out, in a narrow wedge centred on
 * their parent's direction, so the edge from parent to child stays short and
 * radial. Note the render tree is flat -- React Flow parents a composite child
 * to the *entity* (erToReactflowElements.ts:130) even though the edge comes from
 * the parent attribute -- so the nesting lives only in the geometry.
 */

import { Sector, TAU, angleOf, freeSectors, pointOnCircle } from "./geometry";
import { LayoutParams } from "./params";
import { supportRadius } from "./connectors";
import { LayoutGraph, Placement, SatelliteElement, Vec } from "./types";

/** Coordinates are rounded so trig can't make two runs differ in the last bits. */
const round = (value: number) => Math.round(value * 100) / 100;

const roundVec = (v: Vec): Vec => ({ x: round(v.x), y: round(v.y) });

/** Which elements each element is joined to in the drawn diagram. */
const buildAttachments = (graph: LayoutGraph) => {
  const attachments = new Map<string, string[]>();
  const link = (from: string, to: string) =>
    attachments.set(from, [...(attachments.get(from) ?? []), to]);
  for (const connector of graph.connectors)
    for (const participant of connector.participants) {
      link(connector.id, participant);
      link(participant, connector.id);
    }
  return attachments;
};

/**
 * Splits `count` items between the free sectors in proportion to how wide they
 * are, using largest-remainder so the parts always add back up to `count`.
 */
const shareOutBySize = (count: number, sectors: Sector[]) => {
  const total = sectors.reduce((sum, sector) => sum + sector.size, 0);
  if (total === 0 || sectors.length === 0) return [count];

  const exact = sectors.map((sector) => (count * sector.size) / total);
  const shares = exact.map(Math.floor);
  let left = count - shares.reduce((sum, share) => sum + share, 0);

  const byRemainder = exact
    .map((value, index) => ({ index, remainder: value - Math.floor(value) }))
    .sort((a, b) => b.remainder - a.remainder || a.index - b.index);

  for (const { index } of byRemainder) {
    if (left <= 0) break;
    shares[index]++;
    left--;
  }
  return shares;
};

/**
 * The radius at which `count` boxes spread over `sectorSize` radians stop
 * touching each other. Without this, an entity with six attributes packs them
 * into one overlapping arc.
 */
const uncrowdedRadius = (
  count: number,
  sectorSize: number,
  itemWidth: number,
  gap: number,
) => {
  if (count <= 1 || sectorSize <= 0) return 0;
  const spacing = sectorSize / (count + 1);
  return (itemWidth + gap) / spacing;
};

export const placeAttributes = (
  graph: LayoutGraph,
  centres: Placement,
  params: LayoutParams,
): Placement => {
  const placed: Placement = new Map();
  const attachments = buildAttachments(graph);

  const byOwner = new Map<string, SatelliteElement[]>();
  for (const satellite of [...graph.satellites].sort((a, b) =>
    a.key.localeCompare(b.key),
  ))
    byOwner.set(satellite.ownerId, [
      ...(byOwner.get(satellite.ownerId) ?? []),
      satellite,
    ]);

  for (const ownerId of [...byOwner.keys()].sort()) {
    const owner = graph.elements.get(ownerId);
    const ownerCentre = centres.get(ownerId);
    const attributes = byOwner.get(ownerId)!;
    if (owner === undefined || ownerCentre === undefined) {
      // no owner to orbit: leave them where they are rather than at NaN
      for (const attribute of attributes)
        placed.set(attribute.id, { x: 0, y: 0 });
      continue;
    }

    const taken = (attachments.get(ownerId) ?? [])
      .map((id) => centres.get(id))
      .filter((centre): centre is Vec => centre !== undefined)
      .map((centre) => angleOf(ownerCentre, centre));

    const sectors = freeSectors(taken);
    // only what is drawn gets a share of the free sectors; hidden attributes
    // still need a position (the result must cover every node) but must not
    // squeeze the ones the user can actually see
    const firstRing = attributes.filter(
      (attribute) => attribute.parentAttributeId === null && !attribute.hidden,
    );
    const childrenOf = new Map<string, SatelliteElement[]>();
    for (const attribute of attributes)
      if (attribute.parentAttributeId !== null && !attribute.hidden)
        childrenOf.set(attribute.parentAttributeId, [
          ...(childrenOf.get(attribute.parentAttributeId) ?? []),
          attribute,
        ]);

    const shares = shareOutBySize(firstRing.length, sectors);
    let cursor = 0;

    sectors.forEach((sector, sectorIndex) => {
      const share = shares[sectorIndex] ?? 0;
      const inSector = firstRing.slice(cursor, cursor + share);
      cursor += share;
      if (inSector.length === 0) return;

      const spacing = sector.size / (inSector.length + 1);
      const widest = Math.max(
        ...inSector.map((attribute) => attribute.visualWidth),
      );
      const crowdingRadius = uncrowdedRadius(
        inSector.length,
        sector.size,
        widest,
        params.attributeGap,
      );

      inSector.forEach((attribute, index) => {
        const angle = sector.start + spacing * (index + 1);
        const radius = Math.max(
          supportRadius(owner.visualWidth, owner.visualHeight, angle) +
            params.attributeGap +
            supportRadius(attribute.visualWidth, attribute.visualHeight, angle),
          crowdingRadius,
        );
        const centre = pointOnCircle(ownerCentre, angle, radius);
        placed.set(attribute.id, roundVec(centre));

        const children = childrenOf.get(attribute.id) ?? [];
        if (children.length === 0) return;

        // a wedge no wider than the room this attribute was given, so children
        // of adjacent composites cannot interleave
        const wedge = Math.min(spacing * 0.8, Math.PI / 3);
        const childSpacing = wedge / (children.length + 1);
        const widestChild = Math.max(
          ...children.map((child) => child.visualWidth),
        );
        const childCrowding = uncrowdedRadius(
          children.length,
          wedge,
          widestChild,
          params.attributeGap,
        );

        children.forEach((child, childIndex) => {
          const childAngle =
            angle - wedge / 2 + childSpacing * (childIndex + 1);
          const childRadius = Math.max(
            radius +
              supportRadius(
                attribute.visualWidth,
                attribute.visualHeight,
                childAngle,
              ) +
              params.attributeGap +
              supportRadius(child.visualWidth, child.visualHeight, childAngle),
            childCrowding,
          );
          placed.set(
            child.id,
            roundVec(pointOnCircle(ownerCentre, childAngle, childRadius)),
          );
        });
      });
    });

    // Whatever the share-out did not cover still needs a position: hidden
    // attributes, and anything an empty sector list missed. They are spread
    // evenly right around the owner rather than stacked on one point, so that
    // turning attributes back on gives something readable straight away.
    const leftovers = attributes.filter(
      (attribute) => !placed.has(attribute.id),
    );
    leftovers.forEach((attribute, index) => {
      const angle = (TAU * index) / leftovers.length;
      const radius = Math.max(
        supportRadius(owner.visualWidth, owner.visualHeight, angle) +
          params.attributeGap +
          supportRadius(attribute.visualWidth, attribute.visualHeight, angle),
        uncrowdedRadius(
          leftovers.length,
          TAU,
          Math.max(...leftovers.map((item) => item.visualWidth)),
          params.attributeGap,
        ),
      );
      placed.set(
        attribute.id,
        roundVec(pointOnCircle(ownerCentre, angle, radius)),
      );
    });
  }

  return placed;
};

export { shareOutBySize, uncrowdedRadius };
