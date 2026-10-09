import { act, render } from "@testing-library/react";
import { ReactFlowProvider, useStoreApi } from "reactflow";
import { useSelectionEndWithoutBox } from "../../../src/app/hooks/useSelectionEndWithoutBox";

let api: {
  store: ReturnType<typeof useStoreApi>;
  end: () => void;
};

const Probe = () => {
  api = { store: useStoreApi(), end: useSelectionEndWithoutBox() };
  return null;
};

/** The diagram's element, holding one selected node and one that is not. */
const mountDiagram = () => {
  const domNode = document.createElement("div");
  domNode.innerHTML =
    '<div class="react-flow__node" tabindex="0" id="other"></div>' +
    '<div class="react-flow__node selected" tabindex="0" id="picked"></div>';
  document.body.appendChild(domNode);
  render(
    <ReactFlowProvider>
      <Probe />
    </ReactFlowProvider>,
  );
  // what a box selection leaves behind, as React Flow's pane sets it
  act(() => api.store.setState({ domNode, nodesSelectionActive: true }));
};

beforeEach(() => {
  jest.useFakeTimers();
  document.body.innerHTML = "";
});

afterEach(() => {
  jest.useRealTimers();
});

describe("useSelectionEndWithoutBox", () => {
  it("leaves no box around what a box selection picked", () => {
    mountDiagram();
    act(() => api.end());
    expect(api.store.getState().nodesSelectionActive).toBe(false);
  });

  it("hands the focus to a selected element, where the arrow keys look", () => {
    mountDiagram();
    act(() => api.end());
    act(() => jest.runAllTimers());
    expect(document.activeElement?.id).toBe("picked");
  });
});
