import { MouseEvent, useCallback } from "react";
import { useStoreApi } from "reactflow";
import { isMacPlatform } from "../util/historyShortcut";

/** Whether a click adds to the selection: Ctrl+click, Cmd+click on a Mac. */
const isMultiSelecting = (event: MouseEvent) =>
  isMacPlatform() ? event.metaKey : event.ctrlKey;

/**
 * Keeps the selection through a Ctrl+click (Cmd+click on a Mac), wherever it
 * lands. Both handlers go on <ReactFlow>, which hands them to its outer element.
 *
 * React Flow clears the selection on a click on the empty pane, whatever keys
 * are held, so a Ctrl+click that missed every element lost all it had picked.
 * That click is stopped here, before it reaches the pane.
 *
 * And React Flow decides whether a click on an element adds to the selection
 * from its own record of the keys held, which drops the Ctrl when another key
 * is let go under it: after Ctrl+Z, the next Ctrl+click selected its element
 * alone. The record is put right from each press of the mouse, which carries
 * the keys held with it -- capturing, so before the element under the pointer
 * reads it.
 */
export const useCtrlClickKeepsSelection = () => {
  const store = useStoreApi();

  const onMouseDownCapture = useCallback(
    (event: MouseEvent) =>
      store.setState({ multiSelectionActive: isMultiSelecting(event) }),
    [store],
  );

  const onClickCapture = useCallback((event: MouseEvent) => {
    const onPane =
      event.target instanceof Element &&
      event.target.classList.contains("react-flow__pane");
    if (onPane && isMultiSelecting(event)) event.stopPropagation();
  }, []);

  return { onMouseDownCapture, onClickCapture };
};
