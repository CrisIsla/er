/**
 * Turns the React Flow node/edge lists into the graph the discrete search works
 * on: a skeleton of entities and aggregation boxes, the connectors that join
 * them, and the attributes that orbit them.
 *
 * The input shapes are structural, so nothing here imports React Flow -- but the
 * ids, types and edge orientations are exactly the ones erToReactflowElements.ts
 * produces, and the comments say which line of that file each rule comes from.
 */

import {
  GraphEdge,
  buildAttributeParents,
  buildOwnerMap,
  findAggregatedNodeIds,
  isAttributeNode,
} from "../erGraph";
import { DEFAULT_AGGREGATION_SIZE } from "../nodeSize";
import { visualSize } from "./geometry";
import { LayoutParams } from "./params";
import {
  ConnectorElement,
  FrozenElement,
  LayoutElement,
  LayoutGraph,
  SatelliteElement,
  SkeletonElement,
} from "./types";

export type LayoutInputNode = {
  id: string;
  type?: string;
  parentNode?: string;
  hidden?: boolean;
  width?: number | null;
  height?: number | null;
  position: { x: number; y: number };
  data?: { erId?: string };
};

export type LayoutInputEdge = GraphEdge;

/** Entities and aggregation containers: the elements the search places. */
const SKELETON_TYPES = ["entity", "aggregation"];

/** Diamonds and triangles: placed relative to what they join. */
const CONNECTOR_TYPES = ["relationship", "isA"];

/**
 * Fallbacks for nodes React Flow has not measured yet. The layout button has no
 * "everything is measured" guard the way the auto-layout effect does
 * (ControlPanel.tsx:16), so this is reachable. Sizes come from the notation
 * components: DefaultEntity `min-w-[90px] p-2`, DefaultRelationship
 * `h-[95px] w-[95px]`, DefaultIsA `h-16 w-24`, DefaultAttribute `min-w-[60px]
 * p-2`.
 *
 * The aggregation entry is the box a container is created at, and it is only
 * ever reached for a container the layout could not size -- one with nothing
 * inside it. Every container that holds something is measured from its contents
 * before this runs (layout/index.ts, step 0).
 */
const DEFAULT_SIZES: Record<string, { width: number; height: number }> = {
  entity: { width: 90, height: 44 },
  relationship: { width: 95, height: 95 },
  isA: { width: 96, height: 64 },
  "entity-attribute": { width: 60, height: 44 },
  "relationship-attribute": { width: 60, height: 44 },
  "composite-attribute": { width: 60, height: 44 },
  aggregation: DEFAULT_AGGREGATION_SIZE,
};

const FALLBACK_SIZE = { width: 90, height: 44 };

const measure = (node: LayoutInputNode) => {
  const fallback = DEFAULT_SIZES[node.type ?? ""] ?? FALLBACK_SIZE;
  return {
    width: node.width || fallback.width,
    height: node.height || fallback.height,
  };
};

const keyOf = (node: LayoutInputNode) => node.data?.erId ?? node.id;

/** Undirected adjacency over every edge in the diagram. */
const buildAdjacency = (edges: LayoutInputEdge[]) => {
  const adjacency = new Map<string, string[]>();
  const link = (from: string, to: string) =>
    adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
  for (const edge of edges) {
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }
  return adjacency;
};

/**
 * Which entities an ISA triangle joins, and in which direction.
 *
 * inheritanceToReactflowElements (erToReactflowElements.ts:39-56) emits the pair
 * `isA -> child` and `parent -> isA`, so the orientation is what tells the two
 * entities apart.
 */
const hierarchyOf = (
  connectorId: string,
  edges: LayoutInputEdge[],
  skeletonIds: Set<string>,
) => {
  let parentId: string | null = null;
  let childId: string | null = null;
  for (const edge of edges) {
    if (edge.source === connectorId && skeletonIds.has(edge.target))
      childId = edge.target;
    if (edge.target === connectorId && skeletonIds.has(edge.source))
      parentId = edge.source;
  }
  return parentId !== null && childId !== null ? { parentId, childId } : null;
};

export const buildLayoutGraph = (
  nodes: LayoutInputNode[],
  edges: LayoutInputEdge[],
  params: LayoutParams,
): LayoutGraph => {
  const aggregated = findAggregatedNodeIds(nodes);
  const { owner } = buildOwnerMap(nodes, edges);
  const attributeParents = buildAttributeParents(nodes, edges);
  const adjacency = buildAdjacency(edges);

  /**
   * Entities and aggregation boxes: what is placed on its own account whatever
   * the parameters say.
   *
   * A connector's participants are its neighbours among *these*, worked out
   * before any relationship is promoted below. The promotion depends on the
   * count, so the count cannot depend on the promotion.
   */
  const anchored = new Set(
    nodes
      .filter(
        (node) =>
          !aggregated.has(node.id) && SKELETON_TYPES.includes(node.type ?? ""),
      )
      .map((node) => node.id),
  );

  const participantsOf = (node: LayoutInputNode) =>
    Array.from(
      new Set((adjacency.get(node.id) ?? []).filter((id) => anchored.has(id))),
    );

  /**
   * Relationships the search places rather than drops.
   *
   * Two or more distinct participants, because a recursive relationship has no
   * "between" to occupy: its centroid is the one entity it reaches, so it is
   * seated beside it instead, on a cardinal bearing the search would not think
   * to preserve (connectors.ts).
   */
  const placedRelationships = new Set(
    params.relationships.asSkeleton
      ? nodes
          .filter(
            (node) =>
              node.type === "relationship" &&
              !aggregated.has(node.id) &&
              participantsOf(node).length >= 2,
          )
          .map((node) => node.id)
      : [],
  );

  const roleOf = (node: LayoutInputNode) => {
    // an aggregation lays out as one opaque box, so its contents keep the
    // positions they already have
    if (aggregated.has(node.id)) return "frozen" as const;
    if (SKELETON_TYPES.includes(node.type ?? "")) return "skeleton" as const;
    if (placedRelationships.has(node.id)) return "skeleton" as const;
    if (CONNECTOR_TYPES.includes(node.type ?? "")) return "connector" as const;
    if (isAttributeNode(node)) return "satellite" as const;
    return "frozen" as const;
  };

  const skeletonIds = new Set(
    nodes.filter((node) => roleOf(node) === "skeleton").map((node) => node.id),
  );

  /** Attributes owned by each element, so the halo can be sized. */
  const ownedAttributes = new Map<string, LayoutInputNode[]>();
  for (const node of nodes) {
    if (!isAttributeNode(node) || aggregated.has(node.id)) continue;
    const ownerId = owner.get(node.id);
    if (ownerId === undefined) continue;
    ownedAttributes.set(ownerId, [
      ...(ownedAttributes.get(ownerId) ?? []),
      node,
    ]);
  }

  /**
   * Whether an attribute takes up room on the canvas.
   *
   * Hiding attributes is normally a request for a diagram without them, so a
   * hidden one takes up none and the gaps left for it close. `closeHiddenGaps:
   * false` is the other answer: every gap keeps the size the shown view uses, so
   * the attributes appear and disappear without moving anything else.
   */
  const takesRoom = (attribute: LayoutInputNode) =>
    !params.spacing.closeHiddenGaps || attribute.hidden !== true;

  /** How far the attribute fan reaches past the owner's own box. */
  const haloOf = (nodeId: string) => {
    const attributes = (ownedAttributes.get(nodeId) ?? []).filter(takesRoom);
    if (attributes.length === 0) return 0;
    const reach = (attribute: LayoutInputNode) => {
      const { width, height } = measure(attribute);
      return Math.max(width, height);
    };
    const firstRing = params.attributeGap + Math.max(...attributes.map(reach));
    const hasComposite = attributes.some((attribute) =>
      attributeParents.has(attribute.id),
    );
    return hasComposite ? firstRing * 2 : firstRing;
  };

  const elements = new Map<string, LayoutElement>();
  const skeleton: SkeletonElement[] = [];
  const connectors: ConnectorElement[] = [];
  const satellites: SatelliteElement[] = [];
  const frozen: FrozenElement[] = [];

  for (const node of nodes) {
    const role = roleOf(node);
    const type = node.type ?? "";
    const { width, height } = measure(node);
    const visual = visualSize(type, width, height);
    const drawnHalo = role === "frozen" ? 0 : haloOf(node.id);
    // ...and what the arranging stage is told about it, which blind is the same
    // for everything. Not "no ring": whether an element wears one at all is as
    // much a property of the current view as how big it is, so reserving room
    // only where attributes happen to exist would still move the diagram when
    // the first one is added.
    const reserved = params.arrangement.attributeBlind
      ? params.arrangement.blindHalo
      : drawnHalo;
    const base = {
      id: node.id,
      type,
      key: keyOf(node),
      width,
      height,
      visualWidth: visual.width,
      visualHeight: visual.height,
      haloRadius: role === "frozen" ? 0 : reserved,
      drawnHalo,
      hidden: node.hidden === true,
    };

    if (role === "skeleton") {
      // weight is filled in below, once the connectors are known
      const element: SkeletonElement = { ...base, role, weight: 0 };
      elements.set(node.id, element);
      skeleton.push(element);
    } else if (role === "connector") {
      const participants = participantsOf(node);
      const element: ConnectorElement = {
        ...base,
        role,
        participants,
        groupKey: [...participants].sort().join("|"),
        // a recursive relationship reaches one entity through several roles
        // (erToReactflowElements.ts:181), so every edge lands on the same id
        isSelfLoop: participants.length === 1,
        hierarchy:
          type === "isA" ? hierarchyOf(node.id, edges, anchored) : null,
      };
      elements.set(node.id, element);
      connectors.push(element);
    } else if (role === "satellite") {
      const element: SatelliteElement = {
        ...base,
        role,
        ownerId: owner.get(node.id) ?? node.id,
        parentAttributeId: attributeParents.get(node.id) ?? null,
      };
      elements.set(node.id, element);
      satellites.push(element);
    } else {
      const element: FrozenElement = { ...base, role };
      elements.set(node.id, element);
      frozen.push(element);
    }
  }

  // What the search treats as adjacent, which is not the same question as what
  // the diagram draws: it is whatever the search has to keep near whatever else.
  const neighbours = new Map<string, string[]>();
  for (const id of skeletonIds) neighbours.set(id, []);
  const link = (from: string, to: string) => {
    const existing = neighbours.get(from);
    if (existing !== undefined && !existing.includes(to)) existing.push(to);
  };

  // a connector is dropped between the things it joins, so those things have to
  // end up near each other: it contracts to a clique over its participants
  for (const connector of connectors) {
    // a self-loop constrains nothing about where other elements go
    if (connector.participants.length < 2) continue;
    for (const a of connector.participants)
      for (const b of connector.participants) {
        if (a === b) continue;
        link(a, b);
      }
  }

  // a relationship the search places is a element in its own right, so it is
  // adjacent to what it joins rather than a contraction of it. Its participants
  // stop being adjacent to *each other*: what has to sit between them is the
  // diamond, and it is now there to do it.
  for (const node of nodes) {
    if (!placedRelationships.has(node.id)) continue;
    for (const participant of participantsOf(node)) {
      link(node.id, participant);
      link(participant, node.id);
    }
  }

  // ...and the lines the diagram actually draws, which is a different graph
  // again: one link per connector per participant, never contracted. Built from
  // the node list rather than from `connectors`, because whether a diamond is
  // drawn does not depend on who places it.
  const wiring = new Map<string, string[]>();
  const join = (from: string, to: string) =>
    wiring.set(from, [...(wiring.get(from) ?? []), to]);
  for (const node of nodes) {
    if (aggregated.has(node.id)) continue;
    if (!CONNECTOR_TYPES.includes(node.type ?? "")) continue;
    for (const participant of participantsOf(node)) {
      join(node.id, participant);
      join(participant, node.id);
    }
  }

  // how much of the diagram hangs off this element: the lines drawn to it, plus
  // the attributes orbiting it. Read off `wiring` rather than counted from
  // `connectors`, so a relationship the search places is weighed by how many
  // things it joins instead of scoring zero for no longer being a connector.
  //
  // Blind, the attributes drop out and weight is pure degree. That changes what
  // the diagram is seeded on -- a ternary diamond joins three things, which no
  // entity in the corpus beats on lines alone -- and it is meant to: the point
  // is an ordering that does not move when a field is added to an entity.
  for (const element of skeleton)
    element.weight =
      (wiring.get(element.id) ?? []).length +
      (params.arrangement.attributeBlind
        ? 0
        : (ownedAttributes.get(element.id) ?? []).filter(takesRoom).length);

  return {
    elements,
    skeleton,
    connectors,
    satellites,
    frozen,
    neighbours,
    wiring,
  };
};

export { DEFAULT_SIZES, measure };
