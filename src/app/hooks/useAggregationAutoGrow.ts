/**
 * Keeps every aggregation box big enough for what is inside it.
 *
 * The promise the feature makes is that a container always contains its
 * members. A resize cannot break it (the handles are held to a minimum) and a
 * layout run cannot break it (it derives the box from the contents), but an
 * edit to the ER document can: a member joins an aggregation whose size was
 * carried over from before it existed. This grows the box when that happens.
 *
 * It only ever grows. Shrinking a box back down to its contents is the layout
 * button's job -- doing it here would quietly undo a size the user chose.
 *
 * An effect rather than part of the rebuild, because the rebuild runs in the
 * render phase, before React Flow has measured anything.
 */

import { useEffect, useRef } from "react";
import { Node, ReactFlowState, useReactFlow, useStore } from "reactflow";
import { growAggregationsToFit } from "../util/layout/aggregationBox";
import { withNodeSize } from "../util/nodeSize";

/**
 * Changes when a container gains or loses a member, and at no other time.
 *
 * Deliberately blind to `hidden`: attributes are shown and hidden as the
 * pointer moves across the diagram, and a box that resized itself on hover
 * would be unusable.
 */
const membershipFingerprint = (state: ReactFlowState) => {
  const pairs: string[] = [];
  for (const node of state.nodeInternals.values())
    if (node.parentNode !== undefined)
      pairs.push(`${node.parentNode}>${node.id}`);
  return pairs.sort().join("|");
};

type Options = {
  /** held off while a stored layout is still landing, so the two cannot fight */
  enabled: boolean;
  /** runs with the nodes just written, for saving */
  onGrown?: (nodes: Node[]) => void;
};

export const useAggregationAutoGrow = ({ enabled, onGrown }: Options) => {
  const { getNodes, setNodes } = useReactFlow();
  const fingerprint = useStore(membershipFingerprint);

  const onGrownRef = useRef(onGrown);
  onGrownRef.current = onGrown;

  useEffect(() => {
    if (!enabled) return;

    const nodes = getNodes();
    const grown = growAggregationsToFit(nodes);
    // nothing to do is the common case, and returning here is also what keeps
    // this from feeding itself: growing a box changes no membership
    if (grown.size === 0) return;

    const nextNodes = nodes.map((node) => {
      const size = grown.get(node.id);
      return size === undefined ? node : withNodeSize(node, size);
    });
    setNodes(nextNodes);
    onGrownRef.current?.(nextNodes);
  }, [fingerprint, enabled, getNodes, setNodes]);
};
