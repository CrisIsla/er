/**
 * The one file in the layout package that knows about React Flow.
 *
 * Everything under ./ works on plain ids, sizes and centres; this adapter maps a
 * React Flow node list in and out, and matches the shape of the existing ELK
 * entry point so the two algorithms are interchangeable. It also decides what
 * size each node is laid out at, which is not always the one React Flow holds
 * (`layoutSizeOf`).
 */

import { Edge, Node } from "reactflow";
import { layoutDiscreteSearch } from ".";
import { measureAttributeShapes } from "../attributeShape";
import { isAttributeNode } from "../erGraph";
import { NodeSize, readNodeSize, withNodeSize } from "../nodeSize";
import { LayoutInputNode } from "./buildLayoutGraph";
import { LayoutParams } from "./params";

type LayoutSize = {
  width: LayoutInputNode["width"];
  height: LayoutInputNode["height"];
};

/** The label a node is drawn with, when it has one. */
const labelOf = (node: Node): string | null => {
  const label = (node.data as { label?: unknown } | undefined)?.label;
  return typeof label === "string" ? label : null;
};

/**
 * The size the layout is told a node has.
 *
 * Not simply the one React Flow holds, because for some nodes that is not a
 * measurement of the node at all. React Flow never measures a hidden node, and
 * it carries a node's measured size forward **by id** -- and this app's ids are
 * array indices that every diagram reuses. So a hidden attribute holds nothing,
 * or the size it had when it was last drawn, or the size of whatever another
 * diagram drew at its id; and the arranging stage reads every attribute's size,
 * drawn or not (buildLayoutGraph.ts, `declaredAttributes`). Believing it made
 * the same diagram lay out three different ways depending on what had been on
 * screen before.
 *
 * In order:
 *  - an attribute is the size its label is drawn at, measured off a probe
 *    (util/attributeShape.ts) -- drawn or hidden alike, so the hidden view is
 *    arranged exactly as the shown one;
 *  - a hidden node is otherwise the size somebody chose for it, if anybody did,
 *    or no size at all, which the layout reads as its type's default -- never
 *    the size it happens to be wearing;
 *  - anything else is what React Flow measured, which for a drawn node is the
 *    truth.
 */
export const layoutSizeOf = (
  node: Node,
  attributeShapes: ReadonlyMap<string, NodeSize>,
): LayoutSize => {
  if (isAttributeNode(node)) {
    const label = labelOf(node);
    const shape = label === null ? undefined : attributeShapes.get(label);
    if (shape !== undefined)
      return { width: shape.width, height: shape.height };
  }
  if (node.hidden) {
    const authored = readNodeSize(node);
    return { width: authored?.width, height: authored?.height };
  }
  return { width: node.width, height: node.height };
};

/**
 * The nodes as a layout should see them: each at `layoutSizeOf`, with every
 * attribute measured off its label in one pass. Both layouts go through here,
 * this one and the force-directed one (hooks/useLayoutedElements.tsx), so they
 * cannot disagree about how big anything is.
 *
 * Copies: the force-directed layout writes to what it is given. A size nobody
 * knows is left out rather than set to `undefined`, which ELK cannot read --
 * it throws on the key where it would default a missing one.
 */
export const sizedForLayout = <T extends Node>(flowNodes: T[]): T[] => {
  const attributeShapes = measureAttributeShapes(
    flowNodes
      .filter(isAttributeNode)
      .map(labelOf)
      .filter((label): label is string => label !== null),
  );
  return flowNodes.map((node) => {
    const { width, height } = layoutSizeOf(node, attributeShapes);
    const { width: _heldWidth, height: _heldHeight, ...unsized } = node;
    return (
      width == null || height == null ? unsized : { ...unsized, width, height }
    ) as T;
  });
};

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

  const { positions, sizes } = layoutDiscreteSearch(
    sizedForLayout(flowNodes).map(toInput),
    flowEdges.map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    })),
    params,
  );

  return flowNodes.map((node) => {
    const positioned = {
      ...node,
      position: positions.get(node.id) ?? node.position,
    };
    // only aggregation containers are sized by a layout; everything else
    // measures itself from its own label
    const size = sizes.get(node.id);
    return size === undefined ? positioned : withNodeSize(positioned, size);
  });
};
