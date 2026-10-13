import { act, fireEvent, render } from "@testing-library/react";
import ReactFlow, {
  Node,
  ReactFlowProvider,
  useNodesState,
  useStoreApi,
} from "reactflow";
import { useCtrlClickKeepsSelection } from "../../../src/app/hooks/useCtrlClickKeepsSelection";

let store: ReturnType<typeof useStoreApi>;

const selectedPair: Node[] = [
  { id: "a", position: { x: 0, y: 0 }, data: {}, selected: true },
  { id: "b", position: { x: 0, y: 100 }, data: {}, selected: true },
];

const Diagram = () => {
  const [nodes, , onNodesChange] = useNodesState(selectedPair);
  const { onMouseDownCapture, onClickCapture } = useCtrlClickKeepsSelection();
  store = useStoreApi();
  return (
    <ReactFlow
      nodes={nodes}
      onNodesChange={onNodesChange}
      onMouseDownCapture={onMouseDownCapture}
      onClickCapture={onClickCapture}
    />
  );
};

const mountDiagram = () => {
  const { container } = render(
    <ReactFlowProvider>
      <Diagram />
    </ReactFlowProvider>,
  );
  return {
    pane: container.querySelector(".react-flow__pane")!,
    selected: () =>
      Array.from(container.querySelectorAll(".react-flow__node.selected")).map(
        (node) => node.getAttribute("data-id"),
      ),
  };
};

beforeAll(() => {
  // React Flow measures its nodes with one; jsdom has none
  global.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("useCtrlClickKeepsSelection", () => {
  it("keeps the selection through a Ctrl+click on the empty pane", () => {
    const { pane, selected } = mountDiagram();
    fireEvent.click(pane, { ctrlKey: true });
    expect(selected()).toEqual(["a", "b"]);
  });

  it("still lets a plain click on the empty pane clear it", () => {
    const { pane, selected } = mountDiagram();
    fireEvent.click(pane);
    expect(selected()).toEqual([]);
  });

  it("tells React Flow whether Ctrl is held from each press of the mouse", () => {
    const { pane } = mountDiagram();
    // as React Flow's own record of the keys has it after Ctrl+Z, Ctrl held
    act(() => store.setState({ multiSelectionActive: false }));
    // d3's panning reads the window off a press it lets through
    fireEvent.mouseDown(pane, { ctrlKey: true, view: window });
    expect(store.getState().multiSelectionActive).toBe(true);
    fireEvent.mouseDown(pane, { view: window });
    expect(store.getState().multiSelectionActive).toBe(false);
  });

  it("takes Cmd, not Ctrl, on a Mac", () => {
    jest
      .spyOn(navigator, "userAgent", "get")
      .mockReturnValue("Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)");
    const { pane, selected } = mountDiagram();
    fireEvent.click(pane, { metaKey: true });
    expect(selected()).toEqual(["a", "b"]);
    fireEvent.click(pane, { ctrlKey: true });
    expect(selected()).toEqual([]);
  });
});
