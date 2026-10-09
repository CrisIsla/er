/**
 * The boundary between this editor's nodes and the ones shared with the other
 * editors of a diagram (ErDiagramColab).
 *
 * What is selected belongs to one editor. Shared, it would select the same
 * nodes for everyone else -- and a drag moves every selected node, so one
 * editor's selection would ride along with another's drag.
 */

import { Node, XYPosition } from "reactflow";
import * as Y from "yjs";

type Selectable = { id: string; selected?: boolean };

/** The node as the other editors get it: without this editor's selection. */
export const toSharedNode = <T extends Selectable>(node: T): T => {
  const { selected, ...shared } = node;
  return shared as T;
};

/**
 * The shared nodes, selected as they are in this editor.
 *
 * The shared map replaces the local nodes wholesale on every change, this
 * editor's own included, so without this every drag and every peer's edit
 * would drop the selection.
 */
export const withLocalSelection = <T extends Selectable>(
  shared: T[],
  local: Selectable[],
): T[] => {
  const selected = new Set(
    local.filter((node) => node.selected).map((node) => node.id),
  );
  return shared.map((node) =>
    Boolean(node.selected) === selected.has(node.id)
      ? node
      : { ...node, selected: selected.has(node.id) },
  );
};

/**
 * Publishes where a drag left the nodes it moved -- all of them.
 *
 * Dragging a selection moves every node in it, and the shared map replaces the
 * local nodes wholesale, so a node left out here would jump back to where it
 * was. One transaction, so that replacement happens once, with every position
 * already in. A node already there is not written: a click is a drag that
 * goes nowhere, and rewriting the whole selection's positions could beat a
 * peer's drop of one of them that is still on its way.
 */
export const publishPositions = <
  T extends Selectable & { position: XYPosition },
>(
  ydoc: Y.Doc,
  yNodesMap: Y.Map<T>,
  moved: Pick<Node, "id" | "position">[],
) => {
  ydoc.transact(() => {
    for (const { id, position } of moved) {
      const existing = yNodesMap.get(id);
      if (
        existing === undefined ||
        (existing.position.x === position.x &&
          existing.position.y === position.y)
      )
        continue;
      yNodesMap.set(id, toSharedNode({ ...existing, position }));
    }
  });
};
