import { useCallback } from "react";
import { useStoreApi } from "reactflow";

/**
 * Ends a box selection (Shift+drag) without the box React Flow draws around
 * what it selected.
 *
 * The selected elements carry a highlight of their own (globals.css), and the
 * box sat on top of them, taking every click inside it; the group is moved by
 * dragging any of its elements instead. The box also took the focus, which is
 * where React Flow's arrow keys look -- so the focus goes to one of the
 * selected elements, and the arrow keys still move them all.
 */
export const useSelectionEndWithoutBox = () => {
  const store = useStoreApi();
  return useCallback(() => {
    store.setState({ nodesSelectionActive: false });
    // a frame on, once the selection the drag ended with has been drawn
    window.requestAnimationFrame(
      () =>
        store
          .getState()
          .domNode?.querySelector<HTMLElement>(".react-flow__node.selected")
          ?.focus({ preventScroll: true }),
    );
  }, [store]);
};
