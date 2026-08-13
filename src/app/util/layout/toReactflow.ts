/**
 * The one file in the layout package that knows about React Flow.
 *
 * Everything under ./ works on plain ids, sizes and centres; this adapter maps a
 * React Flow node list in and out, and matches the shape of the existing ELK
 * entry point so the two algorithms are interchangeable.
 */

import { Edge, Node } from "reactflow";
import { layoutDiscreteSearch } from ".";
import { LayoutInputNode } from "./buildLayoutGraph";
import { LayoutParams } from "./params";

const toInput = (node: Node): LayoutInputNode => ({
  id: node.id,
  type: node.type,
  parentNode: node.parentNode,
  hidden: node.hidden,
  width: node.width,
  height: node.height,
  position: node.position,
  data: { erId: (node.data as { erId?: string } | undefined)?.erId },
});

export const getDiscreteLayoutedElements = async (
  flowNodes: Node[],
  flowEdges: Edge[],
  params?: LayoutParams,
): Promise<Node[]> => {
  // the search itself is synchronous; yielding first lets the browser paint the
  // frame where new nodes are still invisible, instead of freezing on it
  await Promise.resolve();

  const positions = layoutDiscreteSearch(
    flowNodes.map(toInput),
    flowEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
    params,
  );

  return flowNodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
};
