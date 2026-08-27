/**
 * The size vocabulary shared by everything that reads or writes a node's box.
 *
 * React Flow keeps a node's size in two places and they mean different things:
 *
 *  - `style.width/height` is applied to the node wrapper element, so it is what
 *    actually sizes the DOM box. Nothing writes it unless we ask for it, which
 *    makes it the **authored** size -- the one somebody chose.
 *  - top-level `width/height` is re-derived from the DOM by the ResizeObserver
 *    on every measurement pass, so it is the **measured** size.
 *
 * That distinction is what lets an authored size survive without a "the user
 * changed this" flag: `readNodeSize` asks the authored channel and gets `null`
 * for every node that simply measures itself from its own label.
 *
 * Both channels must always be written together (`withNodeSize`). Writing only
 * the top-level pair leaves the DOM box unchanged, so the observer measures the
 * old size straight back; writing only `style` leaves a frame where the
 * internals still hold the old box, which is the box `extent: "parent"` clamps
 * members into. React Flow's own NodeResizer writes both, and so does
 * `handleParentExpand`; this is that convention, named.
 *
 * Deliberately free of React Flow types so the layout package can use it
 * without breaking its own no-React-Flow rule.
 */

export type NodeSize = { width: number; height: number };

/** Minimal shape of a React Flow node, structurally compatible without importing it. */
export type StyledNode = {
  width?: number | null;
  height?: number | null;
  style?: { width?: number | string; height?: number | string };
};

/** The box an aggregation container is created at, before anything sizes it. */
export const DEFAULT_AGGREGATION_SIZE: NodeSize = { width: 500, height: 500 };

/**
 * Sanity floor for a container with nothing measurable in it -- enough for the
 * label and the resize handles. This is not a policy minimum: a container that
 * holds something is held to what that something needs (see
 * `minimumAggregationSize`), which may be far larger or a little smaller.
 */
export const MIN_AGGREGATION_SIZE: NodeSize = { width: 160, height: 120 };

export const isFiniteSize = (width: unknown, height: unknown): boolean =>
  typeof width === "number" &&
  typeof height === "number" &&
  Number.isFinite(width) &&
  Number.isFinite(height) &&
  width > 0 &&
  height > 0;

/**
 * The size somebody stored on this node, or null.
 *
 * Reads `style` only. Promoting a measurement into the authored channel would
 * freeze every label-sized entity at whatever the browser last rendered.
 */
export const readNodeSize = (node: StyledNode): NodeSize | null => {
  const width = node.style?.width;
  const height = node.style?.height;
  return isFiniteSize(width, height)
    ? { width: width as number, height: height as number }
    : null;
};

/** The only sanctioned way to set a size: writes the authored and measured channels together. */
export const withNodeSize = <T extends StyledNode>(
  node: T,
  size: NodeSize,
): T =>
  ({
    ...node,
    width: size.width,
    height: size.height,
    style: { ...node.style, width: size.width, height: size.height },
  }) as T;
