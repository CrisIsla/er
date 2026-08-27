/**
 * Noticing when a resize gesture finishes, so it can be saved.
 *
 * React Flow has no `onNodeResize` at the diagram level, and NodeResizer lives
 * inside the node component, which has no access to the store where a diagram
 * is saved. But every change the resizer makes travels through `onNodesChange`,
 * so wrapping that is enough and nothing has to be threaded down.
 */

import { useCallback, useRef } from "react";
import { NodeChange, OnNodesChange } from "reactflow";
import { NodeSize } from "../util/nodeSize";

/**
 * The resize gestures that ended in this batch of changes, with the size they
 * ended at.
 *
 * NodeResizer emits `{resizing: true, dimensions}` on each tick of a drag and
 * exactly one `{resizing: false}` -- carrying no dimensions -- when the pointer
 * is released. React Flow's own ResizeObserver also emits dimension changes but
 * leaves `resizing` undefined, so a measurement can never be mistaken for a
 * gesture.
 *
 * The size is taken from `buffer` rather than from the store because these
 * nodes are controlled: nothing has been applied yet when this runs, and the
 * closing change carries no dimensions of its own.
 */
export const collectFinishedResizes = (
  changes: NodeChange[],
  buffer: Map<string, NodeSize>,
): { id: string; size: NodeSize }[] => {
  const finished: { id: string; size: NodeSize }[] = [];

  for (const change of changes) {
    if (change.type !== "dimensions") continue;
    if (change.resizing === true && change.dimensions)
      buffer.set(change.id, change.dimensions);
    if (change.resizing === false) {
      const size = buffer.get(change.id);
      buffer.delete(change.id);
      if (size !== undefined) finished.push({ id: change.id, size });
    }
  }

  return finished;
};

/**
 * Wraps an `onNodesChange` so `onResized` fires once per finished gesture --
 * not once per drag tick, which would save a hundred times for one drag.
 */
export const useResizeCommit = (
  onNodesChange: OnNodesChange,
  onResized: (id: string, size: NodeSize) => void,
): OnNodesChange => {
  const buffer = useRef(new Map<string, NodeSize>());
  const onResizedRef = useRef(onResized);
  onResizedRef.current = onResized;

  return useCallback(
    (changes: NodeChange[]) => {
      const finished = collectFinishedResizes(changes, buffer.current);
      onNodesChange(changes);
      for (const { id, size } of finished) onResizedRef.current(id, size);
    },
    [onNodesChange],
  );
};
