/**
 * Shared reading of the ER graph: which nodes are attributes, which element owns
 * each of them, and which nodes live inside an aggregation.
 *
 * Free of React Flow types (the shapes below are structurally compatible), so
 * both the attribute-visibility hook and the automatic layout can use it without
 * pulling React into a pure module.
 */

export type GraphNode = {
  id: string;
  type?: string;
  parentNode?: string;
};

export type GraphEdge = {
  id: string;
  source: string;
  target: string;
};

export const ATTRIBUTE_NODE_TYPES = [
  "entity-attribute",
  "relationship-attribute",
  "composite-attribute",
];

export const isAttributeNode = (node: { type?: string }) =>
  ATTRIBUTE_NODE_TYPES.includes(node.type ?? "");

/**
 * Maps every attribute to the entity or relationship that owns it.
 *
 * Derived from the edges rather than `parentNode`, because aggregations
 * re-parent everything they contain to the aggregation node
 * (erToReactflowElements.ts:373) -- so an attribute inside an aggregation has
 * lost the link to its own entity. Walking attribute-only paths outwards from
 * each structural node also resolves composite attributes, which hang off
 * another attribute rather than off the entity directly.
 */
export const buildOwnerMap = (nodes: GraphNode[], edges: GraphEdge[]) => {
  const attributeIds = new Set(
    nodes.filter(isAttributeNode).map((node) => node.id),
  );

  const adjacency = new Map<string, string[]>();
  const link = (from: string, to: string) =>
    adjacency.set(from, [...(adjacency.get(from) ?? []), to]);
  for (const edge of edges) {
    link(edge.source, edge.target);
    link(edge.target, edge.source);
  }

  const owner = new Map<string, string>();
  for (const node of nodes) {
    if (isAttributeNode(node)) continue;
    const queue = [...(adjacency.get(node.id) ?? [])];
    const seen = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift()!;
      if (seen.has(current) || !attributeIds.has(current)) continue;
      seen.add(current);
      if (!owner.has(current)) owner.set(current, node.id);
      for (const neighbour of adjacency.get(current) ?? [])
        if (attributeIds.has(neighbour) && !seen.has(neighbour))
          queue.push(neighbour);
    }
  }
  return { owner, attributeIds };
};

/**
 * The attribute an attribute hangs off, when it is a composite child.
 *
 * Composite children are edge-linked to their parent attribute
 * (erToReactflowElements.ts:135-142) even though React Flow parents them to the
 * entity, so the render tree is flat while the semantic tree has two levels.
 */
export const buildAttributeParents = (
  nodes: GraphNode[],
  edges: GraphEdge[],
) => {
  const attributeIds = new Set(
    nodes.filter(isAttributeNode).map((node) => node.id),
  );
  const parents = new Map<string, string>();
  for (const edge of edges)
    if (attributeIds.has(edge.source) && attributeIds.has(edge.target))
      parents.set(edge.target, edge.source);
  return parents;
};

/**
 * Ids of the nodes contained in an aggregation box.
 *
 * Aggregations can nest (an aggregation may participate in a relationship that
 * is itself aggregated), so the parent chain is walked rather than checked one
 * level deep. The container itself is not a member of its own set.
 */
export const findAggregatedNodeIds = (nodes: GraphNode[]) => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const inside = new Set<string>();

  for (const node of nodes) {
    let parentId = node.parentNode;
    const seen = new Set<string>([node.id]);
    while (parentId && !seen.has(parentId)) {
      seen.add(parentId);
      const parent = byId.get(parentId);
      if (!parent) break;
      if (parent.type === "aggregation") {
        inside.add(node.id);
        break;
      }
      parentId = parent.parentNode;
    }
  }
  return inside;
};
