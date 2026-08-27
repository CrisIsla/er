/**
 * Merging a freshly generated diagram onto the one already on screen.
 *
 * The ERdoc is the source of truth, so every semantic edit rebuilds all of the
 * nodes from the AST. Anything the user chose that the AST does not know about
 * -- where a node sits, how big a container is -- would be lost unless it is
 * carried across here, which is what this does.
 *
 * Both diagram components ran their own copy of this logic, which is exactly
 * how they came to share a bug (an aggregation's size was "preserved" through a
 * field nothing rendered). One copy, and it is a pure function, so the merge
 * rules can be tested without a DOM.
 */

import { ErJSON } from "../hooks/useJSON";
import { NodeSize, isFiniteSize, readNodeSize, withNodeSize } from "./nodeSize";

/** Minimal shape of a React Flow node, structurally compatible without importing it. */
export type RebuildNode = {
  id: string;
  position: { x: number; y: number };
  hidden?: boolean;
  data: { erId?: string };
  width?: number | null;
  height?: number | null;
  style?: { width?: number | string; height?: number | string };
};

/** A stored layout, as a pair of lookups usable during render. */
export type IncomingLayout = {
  positions: Map<string, { x: number; y: number }>;
  sizes: Map<string, NodeSize>;
};

/**
 * Reads the layout that arrived with an example, an import or localStorage.
 *
 * A record with no size -- every file written before sizes existed, and all
 * five bundled examples -- produces no entry rather than an entry of
 * `undefined`, so the merge below falls through to the size the node already
 * has instead of clobbering it. The same filter rejects a malformed size from
 * an untyped source (the diagram document is `Mixed` server-side), which makes
 * this the one place every stored size has to pass through.
 */
export const incomingLayout = (
  records: ErJSON["nodes"] | null | undefined,
): IncomingLayout | null =>
  records == null
    ? null
    : {
        positions: new Map(
          records.map((record) => [record.id, record.position]),
        ),
        sizes: new Map(
          records
            .filter((record) => isFiniteSize(record.width, record.height))
            .map((record) => [
              record.id,
              { width: record.width!, height: record.height! },
            ]),
        ),
      };

export type RebuildInput<T extends RebuildNode> = {
  /** what is on screen now */
  oldNodes: T[];
  /** what erToReactflowElements just produced */
  newNodes: T[];
  incoming: IncomingLayout | null;
  attributeIds: Set<string>;
  attributesStartHidden: boolean;
  /**
   * True when the node and edge counts are unchanged, so a node that lost its
   * `erId` match can still be recognised by id. Ids are array indices
   * (erToReactflowElements' renameIdsToNumeric), so this is what lets a rename
   * keep the diagram in place.
   */
  renaming: boolean;
};

export const mergeRebuiltNodes = <T extends RebuildNode>({
  oldNodes,
  newNodes,
  incoming,
  attributeIds,
  attributesStartHidden,
  renaming,
}: RebuildInput<T>): T[] => {
  const matched = new Set<string>();

  const hiddenFor = (node: T) =>
    attributeIds.has(node.id) ? attributesStartHidden : node.hidden;

  /**
   * A stored size wins over the one the node already has, exactly as a stored
   * position does one line up. Not aggregation-specific: `readNodeSize` returns
   * null for every node that merely measures itself from its own label.
   */
  const sized = (node: T, fallback: T): T => {
    const size = incoming?.sizes.get(node.id) ?? readNodeSize(fallback);
    return size === null ? node : withNodeSize(node, size);
  };

  const kept = oldNodes
    .map((oldNode) => {
      let newNode = newNodes.find(
        (candidate) => candidate.data.erId === oldNode.data.erId,
      );
      if (!newNode && renaming)
        newNode = newNodes.find((candidate) => candidate.id === oldNode.id);
      if (newNode === undefined) return undefined;

      matched.add(newNode.id);
      return sized(
        {
          ...newNode,
          position: incoming?.positions.get(newNode.id) ?? oldNode.position,
          hidden: hiddenFor(newNode),
        } as T,
        oldNode,
      );
    })
    .filter((node): node is T => node !== undefined);

  const added = newNodes
    .filter((newNode) => !matched.has(newNode.id))
    .map((newNode) =>
      sized(
        {
          ...newNode,
          position: incoming?.positions.get(newNode.id) ?? newNode.position,
          hidden: hiddenFor(newNode),
          // new nodes are created invisible so they cannot flash at the
          // generator's seed position before a layout moves them
          style: { ...newNode.style, opacity: 1 },
        } as T,
        newNode,
      ),
    );

  return [...kept, ...added];
};
