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

  const roleOf = (node: LayoutInputNode) => {
    // an aggregation lays out as one opaque box, so its contents keep the
    // positions they already have
    if (aggregated.has(node.id)) return "frozen" as const;
    if (SKELETON_TYPES.includes(node.type ?? "")) return "skeleton" as const;
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
   * How far the attribute fan reaches past the owner's own box.
   *
   * Sized from the attributes that are actually drawn. Hiding attributes is a
   * request for a diagram without them, so reserving their space anyway would
   * leave the skeleton spread out around gaps the user cannot see.
   */
  const haloOf = (nodeId: string) => {
    const attributes = (ownedAttributes.get(nodeId) ?? []).filter(
      (attribute) => attribute.hidden !== true,
    );
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
    const base = {
      id: node.id,
      type,
      key: keyOf(node),
      width,
      height,
      visualWidth: visual.width,
      visualHeight: visual.height,
      haloRadius: role === "frozen" ? 0 : haloOf(node.id),
      hidden: node.hidden === true,
    };

    if (role === "skeleton") {
      // weight is filled in below, once the connectors are known
      const element: SkeletonElement = { ...base, role, weight: 0 };
      elements.set(node.id, element);
      skeleton.push(element);
    } else if (role === "connector") {
      const participants = Array.from(
        new Set(
          (adjacency.get(node.id) ?? []).filter((id) => skeletonIds.has(id)),
        ),
      );
      const element: ConnectorElement = {
        ...base,
        role,
        participants,
        groupKey: [...participants].sort().join("|"),
        // a recursive relationship reaches one entity through several roles
        // (erToReactflowElements.ts:181), so every edge lands on the same id
        isSelfLoop: participants.length === 1,
        hierarchy:
          type === "isA" ? hierarchyOf(node.id, edges, skeletonIds) : null,
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

  // adjacency between skeleton elements, induced by the connectors
  const neighbours = new Map<string, string[]>();
  for (const id of skeletonIds) neighbours.set(id, []);
  for (const connector of connectors) {
    // a self-loop constrains nothing about where other entities go
    if (connector.participants.length < 2) continue;
    for (const a of connector.participants)
      for (const b of connector.participants) {
        if (a === b) continue;
        const existing = neighbours.get(a)!;
        if (!existing.includes(b)) existing.push(b);
      }
  }

  const connectorCount = new Map<string, number>();
  for (const connector of connectors)
    for (const participant of connector.participants)
      connectorCount.set(
        participant,
        (connectorCount.get(participant) ?? 0) + 1,
      );

  for (const element of skeleton)
    element.weight =
      (connectorCount.get(element.id) ?? 0) +
      (ownedAttributes.get(element.id) ?? []).filter(
        (attribute) => attribute.hidden !== true,
      ).length;

  return { elements, skeleton, connectors, satellites, frozen, neighbours };
};

export { DEFAULT_SIZES, measure };
