import { act, render } from "@testing-library/react";
import { ReactNode } from "react";
import { Node, ReactFlowProvider, useReactFlow, useStoreApi } from "reactflow";
import * as Y from "yjs";
import {
  DiagramHistoryProvider,
  Gesture,
  SharedNodes,
  useDiagramHistory,
} from "../../../src/app/hooks/useDiagramHistory";
import { DiagramChange } from "../../../src/app/types/CodeEditor";
import { ErNode } from "../../../src/app/types/ErDiagram";

const entity = (id: string, name: string, x: number, y: number): Node => ({
  id,
  type: "entity",
  position: { x, y },
  data: { label: name, erId: `entity: ${name}` },
});

let api: {
  flow: ReturnType<typeof useReactFlow>;
  history: ReturnType<typeof useDiagramHistory>;
  store: ReturnType<typeof useStoreApi>;
};

/**
 * Hands the test React Flow and the history. There is no <ReactFlow> here, so
 * the store is told it owns its nodes, which routes setNodes straight to it.
 */
const Probe = () => {
  const store = useStoreApi();
  store.setState({ hasDefaultNodes: true });
  api = { flow: useReactFlow(), history: useDiagramHistory(), store };
  return null;
};

const tree = (lastChange: DiagramChange | null, shared?: SharedNodes) => (
  <ReactFlowProvider>
    <DiagramHistoryProvider lastChange={lastChange} shared={shared}>
      <Probe />
    </DiagramHistoryProvider>
  </ReactFlowProvider>
);

const mount = (shared?: SharedNodes) => {
  const view = render(tree(null, shared));
  return {
    rerender: (lastChange: DiagramChange | null) =>
      view.rerender(tree(lastChange, shared)),
  };
};

const setNodes = (nodes: Node[]) => act(() => api.flow.setNodes(nodes));
const positionOf = (id: string) => api.flow.getNode(id)!.position;
const flush = () => act(() => jest.runAllTimers());

/** Presses a key on `target` and reports whether something prevented it. */
const press = (init: KeyboardEventInit, target: Element = document.body) => {
  const event = new KeyboardEvent("keydown", {
    bubbles: true,
    cancelable: true,
    ...init,
  });
  act(() => {
    target.dispatchEvent(event);
  });
  return event.defaultPrevented;
};
const ctrlZ = { key: "z", code: "KeyZ", ctrlKey: true };
const ctrlY = { key: "y", code: "KeyY", ctrlKey: true };

const moveTo = (id: string, x: number, y: number) =>
  setNodes(
    api.flow
      .getNodes()
      .map((node) => (node.id === id ? { ...node, position: { x, y } } : node)),
  );

/** Starts a drag of `id` the way a diagram reports one to the history. */
const startDrag = (id: string) => {
  let gesture: Gesture | undefined;
  act(() => {
    gesture = api.history.begin("pointer", [{ id }]);
  });
  return gesture!;
};

/** Drags `id` to (x, y), start to drop. */
const drag = (id: string, x: number, y: number) => {
  const gesture = startDrag(id);
  moveTo(id, x, y);
  act(() => gesture.commit());
  flush();
};

/**
 * An arrow-key nudge of `id` to (x, y), the way React Flow delivers one: it
 * moves its store's node object in place first, and only then reports the
 * change -- with the diagram's own nodes, still unmoved, as `before`.
 */
const nudge = (id: string, x: number, y: number) => {
  const before = api.flow
    .getNodes()
    .map((node) => ({ ...node, position: { ...node.position } }));
  act(() => {
    const internal = api.store.getState().nodeInternals.get(id)!;
    internal.position = { x, y };
    internal.positionAbsolute = { x, y };
    api.history.noticeChanges(
      [{ id, type: "position", position: { x, y }, dragging: false }],
      before,
    );
  });
  moveTo(id, x, y);
};

/** A shared diagram holding `nodes`, mirrored in the store as the observer would. */
const shared = (nodes: Node[]) => {
  const ydoc = new Y.Doc();
  const yNodesMap = ydoc.getMap<ErNode>("nodesMap");
  mount({ ydoc, yNodesMap });
  setNodes(nodes);
  for (const node of nodes) yNodesMap.set(node.id, node as ErNode);
  return yNodesMap;
};

beforeEach(() => {
  jest.useFakeTimers();
  localStorage.clear();
  document.body.innerHTML = "";
});

afterEach(() => {
  jest.useRealTimers();
});

describe("DiagramHistoryProvider", () => {
  it("undoes a drag on Ctrl+Z and redoes it on Ctrl+Y", () => {
    mount();
    setNodes([entity("0", "A", 0, 0), entity("1", "B", 100, 0)]);
    drag("0", 40, 30);

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 0, y: 0 });
    press(ctrlY);
    expect(positionOf("0")).toEqual({ x: 40, y: 30 });
    expect(positionOf("1")).toEqual({ x: 100, y: 0 });
  });

  it("saves what an undo did", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    drag("0", 40, 30);
    press(ctrlZ);
    flush();
    const saved = JSON.parse(localStorage.getItem("er-flow")!);
    expect(saved.nodes[0].position).toEqual({ x: 0, y: 0 });
  });

  it("leaves Ctrl+Z typed into a text field to the field", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    drag("0", 40, 30);
    const field = document.body.appendChild(document.createElement("textarea"));

    expect(press(ctrlZ, field)).toBe(false);
    expect(positionOf("0")).toEqual({ x: 40, y: 30 });
  });

  it("keeps the browser's own undo off the page even with nothing to undo", () => {
    mount();
    expect(press(ctrlZ)).toBe(true);
  });

  it("does nothing while a drag is still under way", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    drag("0", 40, 30);
    startDrag("0");
    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 40, y: 30 });
  });

  it("lets a gesture's late commit end only that gesture", () => {
    mount();
    setNodes([entity("0", "A", 0, 0), entity("1", "B", 100, 0)]);
    const first = startDrag("0");
    moveTo("0", 10, 0);
    // the next drag begins before the first one's commit has landed
    const second = startDrag("1");
    act(() => first.commit());
    flush();
    moveTo("1", 200, 0);
    act(() => second.commit());
    flush();

    press(ctrlZ);
    expect(positionOf("1")).toEqual({ x: 100, y: 0 });
    expect(positionOf("0")).toEqual({ x: 10, y: 0 });
    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 0, y: 0 });
  });

  it("ends a drag that never heard its own end when the pointer is released", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    startDrag("0");
    moveTo("0", 40, 30);
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event("pointerup"), { isPrimary: true }),
      );
    });
    flush();

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 0, y: 0 });
  });

  it("records a write that knows its result without waiting for a flush", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    let gesture: Gesture | undefined;
    act(() => {
      gesture = api.history.begin("layout");
    });
    const laidOut = [entity("0", "A", 70, 70)];
    setNodes(laidOut);
    act(() => gesture!.commitAt(laidOut));

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 0, y: 0 });
  });

  it("records a nudge from where it started, though React Flow moved the store first", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    nudge("0", 5, 0);
    flush();

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 0, y: 0 });
  });

  it("makes a run of nudges, each within the settling time, one step", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    for (const x of [5, 10, 15]) {
      nudge("0", x, 0);
      act(() => jest.advanceTimersByTime(400));
    }
    flush();

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 0, y: 0 });
  });

  it("makes nudges further apart than that separate steps", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    nudge("0", 5, 0);
    act(() => jest.advanceTimersByTime(600));
    nudge("0", 10, 0);
    flush();

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 5, y: 0 });
  });

  it("undoes a run of nudges that is still settling", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    nudge("0", 5, 0);
    nudge("0", 10, 0);

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 0, y: 0 });
  });

  it("saves a run of nudges once it settles", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    nudge("0", 5, 0);
    flush();
    const saved = JSON.parse(localStorage.getItem("er-flow")!);
    expect(saved.nodes[0].position).toEqual({ x: 5, y: 0 });
  });

  it("counts arrow keys pressed during a drag as part of the drag", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    const gesture = startDrag("0");
    moveTo("0", 20, 0);
    nudge("0", 25, 0);
    moveTo("0", 45, 30);
    act(() => gesture.commit());
    flush();

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 0, y: 0 });
  });

  it("records a drop where it landed, even when the last move lands after the drop", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    const gesture = startDrag("0");
    moveTo("0", 40, 30);
    act(() => {
      gesture.commit();
      api.flow.setNodes([entity("0", "A", 42, 30)]);
    });
    flush();

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 0, y: 0 });
  });

  it("lets a drag's own end win over the release safety net", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    const gesture = startDrag("0");
    moveTo("0", 40, 30);
    act(() => {
      window.dispatchEvent(
        Object.assign(new Event("pointerup"), { isPrimary: true }),
      );
      // the mouseup that follows lands the last move, then ends the drag
      api.flow.setNodes([entity("0", "A", 42, 30)]);
      gesture.commit();
    });
    flush();

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 0, y: 0 });
  });

  it("keeps a node something else moved during my drag out of my step", () => {
    mount();
    setNodes([entity("0", "A", 0, 0), entity("1", "B", 100, 0)]);
    const gesture = startDrag("0");
    moveTo("0", 40, 30);
    moveTo("1", 300, 300);
    act(() => gesture.commit());
    flush();

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 0, y: 0 });
    expect(positionOf("1")).toEqual({ x: 300, y: 300 });
  });

  it("follows an element renamed in the code", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    drag("0", 40, 30);
    const before = api.flow.getNodes();
    const renamed = [entity("0", "Z", 40, 30)];
    setNodes(renamed);
    act(() => api.history.noticeRebuild(before, renamed));

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 0, y: 0 });
  });

  it("takes no rename from an edit that only shifted the ids", () => {
    mount();
    setNodes([
      entity("0", "A", 0, 0),
      entity("1", "B", 100, 0),
      entity("2", "C", 200, 0),
    ]);
    drag("2", 240, 30);
    const before = api.flow.getNodes();
    // A removed at the top, D added at the end: as many nodes as before, and
    // every id now names another element -- but no element was renamed
    const shifted = [
      entity("0", "B", 100, 0),
      entity("1", "C", 240, 30),
      entity("2", "D", 500, 500),
    ];
    setNodes(shifted);
    act(() => api.history.noticeRebuild(before, shifted));

    press(ctrlZ);
    expect(positionOf("1")).toEqual({ x: 200, y: 0 });
    expect(positionOf("2")).toEqual({ x: 500, y: 500 });
  });

  it("does not take a drag's moves for nudges", () => {
    mount();
    setNodes([entity("0", "A", 0, 0)]);
    act(() =>
      api.history.noticeChanges(
        [
          {
            id: "0",
            type: "position",
            position: { x: 9, y: 9 },
            dragging: true,
          },
        ],
        api.flow.getNodes(),
      ),
    );
    setNodes([entity("0", "A", 9, 9)]);
    flush();
    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 9, y: 9 });
  });

  it("keeps the history through an edit of the code", () => {
    const { rerender } = mount();
    setNodes([entity("0", "A", 0, 0)]);
    drag("0", 40, 30);
    rerender({ type: "userInput" });

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 0, y: 0 });
  });

  it("starts a new history when a whole document arrives", () => {
    const { rerender } = mount();
    setNodes([entity("0", "A", 0, 0)]);
    drag("0", 40, 30);
    rerender({ type: "json", positions: { nodes: [], edges: [] } });

    press(ctrlZ);
    expect(positionOf("0")).toEqual({ x: 40, y: 30 });
  });

  it("never undoes over a peer's move that the store has not caught up with", () => {
    const ydoc = new Y.Doc();
    const yNodesMap = ydoc.getMap<ErNode>("nodesMap");
    mount({ ydoc, yNodesMap });
    const nodes = [entity("0", "A", 0, 0)];
    setNodes(nodes);
    yNodesMap.set("0", nodes[0] as ErNode);
    drag("0", 40, 30);
    // a peer moved it on; the map has it, the store does not yet
    yNodesMap.set("0", { ...yNodesMap.get("0")!, position: { x: 250, y: 80 } });

    press(ctrlZ);
    expect(yNodesMap.get("0")!.position).toEqual({ x: 250, y: 80 });
  });

  it("does not take a peer's move during a run of nudges for part of the run", () => {
    const yNodesMap = shared([entity("0", "A", 0, 0)]);
    nudge("0", 5, 0);
    // within the settling time a peer drags it on, and the store follows
    yNodesMap.set("0", {
      ...yNodesMap.get("0")!,
      position: { x: 300, y: 300 },
    });
    moveTo("0", 300, 300);
    flush();

    press(ctrlZ);
    expect(yNodesMap.get("0")!.position).toEqual({ x: 300, y: 300 });
  });

  it("publishes a layout only where nobody has moved a node since it began", () => {
    const yNodesMap = shared([
      entity("0", "A", 0, 0),
      entity("1", "B", 100, 0),
    ]);
    // a peer's move: in the map, not yet in the store
    yNodesMap.set("1", {
      ...yNodesMap.get("1")!,
      position: { x: 300, y: 300 },
    });
    let gesture: Gesture | undefined;
    act(() => {
      gesture = api.history.begin("layout");
    });
    const laidOut = [entity("0", "A", 50, 50), entity("1", "B", 150, 50)];
    setNodes(laidOut);
    act(() => gesture!.commitAt(laidOut));

    expect(yNodesMap.get("0")!.position).toEqual({ x: 50, y: 50 });
    expect(yNodesMap.get("1")!.position).toEqual({ x: 300, y: 300 });
  });

  it("publishes an undo to a shared diagram rather than writing it locally", () => {
    const ydoc = new Y.Doc();
    const yNodesMap = ydoc.getMap<ErNode>("nodesMap");
    mount({ ydoc, yNodesMap });
    const nodes = [entity("0", "A", 0, 0)];
    setNodes(nodes);
    yNodesMap.set("0", nodes[0] as ErNode);
    drag("0", 40, 30);
    // keeping the step published it
    expect(yNodesMap.get("0")!.position).toEqual({ x: 40, y: 30 });

    press(ctrlZ);
    expect(yNodesMap.get("0")!.position).toEqual({ x: 0, y: 0 });
  });
});
