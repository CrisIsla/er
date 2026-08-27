/**
 * Resizing an aggregation container, with its contents.
 *
 * Two things happen while a resize handle is dragged, and both live here:
 *
 *  - every member is repositioned so it keeps its place in the box -- a member
 *    40% of the way across stays 40% of the way across;
 *  - the handles are held to a minimum derived from the contents, so the box
 *    cannot be dragged smaller than what it holds.
 *
 * React Flow's NodeResizer owns the gesture itself and pushes the new
 * dimensions into the store on its own; this only adds the members.
 */

import { useCallback, useRef, useState } from "react";
import {
  NodePositionChange,
  OnResize,
  OnResizeEnd,
  OnResizeStart,
  useStore,
  useStoreApi,
} from "reactflow";
import { PositionedNode } from "../util/alignmentCandidates";
import {
  ResizeSnapshot,
  resizeFloor,
  resizeSnapshot,
  scaleMembers,
} from "../util/layout/aggregationBox";
import {
  DEFAULT_AGGREGATION_SIZE,
  MIN_AGGREGATION_SIZE,
  NodeSize,
} from "../util/nodeSize";

const sameSize = (a: NodeSize, b: NodeSize) =>
  a.width === b.width && a.height === b.height;

export const useAggregationResize = (containerId: string | null) => {
  const store = useStoreApi();

  /**
   * The box to draw at.
   *
   * A narrow selector on purpose: subscribing to the node object itself
   * re-renders the container on every store write anywhere in the diagram,
   * because React Flow rebuilds every internals object each time.
   */
  const size = useStore(
    useCallback(
      (state) => {
        const node = containerId
          ? state.nodeInternals.get(containerId)
          : undefined;
        return {
          width: node?.width ?? DEFAULT_AGGREGATION_SIZE.width,
          height: node?.height ?? DEFAULT_AGGREGATION_SIZE.height,
        };
      },
      [containerId],
    ),
    sameSize,
  );

  /**
   * How far in the handles may be dragged: the point at which the contents,
   * compressing with the box, would start to touch.
   */
  const derivedMin = useStore(
    useCallback(
      (state) => {
        const node = containerId
          ? state.nodeInternals.get(containerId)
          : undefined;
        if (node === undefined) return MIN_AGGREGATION_SIZE;
        return resizeFloor(
          resizeSnapshot(
            Array.from(state.nodeInternals.values()) as PositionedNode[],
            node.id,
            {
              width: node.width ?? DEFAULT_AGGREGATION_SIZE.width,
              height: node.height ?? DEFAULT_AGGREGATION_SIZE.height,
            },
          ),
        );
      },
      [containerId],
    ),
    sameSize,
  );

  const derivedMinRef = useRef(derivedMin);
  derivedMinRef.current = derivedMin;

  /**
   * The minimum is held still for the length of a gesture.
   *
   * The floor is invariant under the transform, so this changes nothing about
   * where the drag stops -- it is a hard requirement of the library.
   * minWidth/minHeight sit in
   * ResizeControl's effect dependencies, so a value that changed mid-gesture
   * would re-register the drag handlers -- which on a touch device ends the
   * gesture outright. Freezing at a value equal to the live one keeps the props
   * numerically unchanged across that render.
   */
  const [frozenMin, setFrozenMin] = useState<NodeSize | null>(null);
  const min = frozenMin ?? derivedMin;

  const snapshotRef = useRef<ResizeSnapshot | null>(null);
  const lastEmitted = useRef(new Map<string, { x: number; y: number }>());
  const containerIdRef = useRef(containerId);
  containerIdRef.current = containerId;

  const applyScale = useCallback(
    (width: number, height: number) => {
      const snapshot = snapshotRef.current;
      if (snapshot === null) return;

      const changes: NodePositionChange[] = [];
      for (const { id, position } of scaleMembers(snapshot, {
        width,
        height,
      })) {
        const previous = lastEmitted.current.get(id);
        if (previous?.x === position.x && previous?.y === position.y) continue;
        lastEmitted.current.set(id, position);
        // `position`, never `positionAbsolute`: React Flow recomputes that from
        // the parent chain, which is also what moves the members for free when
        // a top or left handle drags the container itself
        changes.push({ id, type: "position", position });
      }

      // NOT setNodes: in a controlled flow that emits `reset` changes, and
      // applyChanges discards the rest of the batch when it sees one -- which
      // would include the resizer's own dimension change, queued a moment later
      if (changes.length > 0) store.getState().triggerNodeChanges(changes);
    },
    [store],
  );

  // all three keep a stable identity, for the same effect-dependency reason the
  // frozen minimum exists
  const onResizeStart: OnResizeStart = useCallback(
    (_event, params) => {
      const id = containerIdRef.current;
      if (id === null || params.width <= 0 || params.height <= 0) {
        snapshotRef.current = null;
        return;
      }
      snapshotRef.current = resizeSnapshot(
        Array.from(store.getState().nodeInternals.values()) as PositionedNode[],
        id,
        { width: params.width, height: params.height },
      );
      lastEmitted.current = new Map();
      setFrozenMin(derivedMinRef.current);
    },
    [store],
  );

  const onResize: OnResize = useCallback(
    (_event, params) => applyScale(params.width, params.height),
    [applyScale],
  );

  const onResizeEnd: OnResizeEnd = useCallback(
    (_event, params) => {
      // one last pass with the final size, so what is committed is a pure
      // function of the snapshot no matter which ticks the pointer produced
      applyScale(params.width, params.height);
      snapshotRef.current = null;
      lastEmitted.current = new Map();
      setFrozenMin(null);
    },
    [applyScale],
  );

  return {
    width: size.width,
    height: size.height,
    minWidth: Math.max(min.width, MIN_AGGREGATION_SIZE.width),
    minHeight: Math.max(min.height, MIN_AGGREGATION_SIZE.height),
    onResizeStart,
    onResize,
    onResizeEnd,
  };
};
