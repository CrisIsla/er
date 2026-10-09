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
import {
  Layout,
  LayoutNode,
  isLaidOut,
  layoutKey,
  withLayout,
} from "./layoutHistory";

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

/**
 * Publishes layouts -- positions, and the sizes somebody chose -- onto the
 * nodes they are for.
 *
 * The layouts come from the diagram's history, so the nodes are found by what
 * they are rather than by id: a code edit since can have handed the id to
 * another node (see layoutHistory.ts). One transaction, for the reason
 * publishPositions gives; a node already laid out that way is not written, so
 * publishing what is already shared changes nothing.
 *
 * With `onlyFrom`, a node is written only while the map still has it where
 * that layout says -- so what this editor publishes late never lands on top
 * of a newer move by somebody else.
 */
export const publishLayout = <T extends Selectable & LayoutNode>(
  ydoc: Y.Doc,
  yNodesMap: Y.Map<T>,
  layouts: Map<string, Layout>,
  onlyFrom?: Map<string, Layout>,
) => {
  if (layouts.size === 0) return;
  ydoc.transact(() => {
    for (const [id, existing] of yNodesMap.entries()) {
      const key = layoutKey(existing);
      const layout = layouts.get(key);
      if (layout === undefined || isLaidOut(existing, layout)) continue;
      const from = onlyFrom?.get(key);
      if (from !== undefined && !isLaidOut(existing, from)) continue;
      yNodesMap.set(id, toSharedNode(withLayout(existing, layout)));
    }
  });
};
