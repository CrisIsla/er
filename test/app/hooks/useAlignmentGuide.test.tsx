import { act, render } from "@testing-library/react";
import { MouseEvent as ReactMouseEvent } from "react";
import { Node, ReactFlowProvider, useStoreApi } from "reactflow";
import { useAlignmentGuide } from "../../../src/app/hooks/useAlignmentGuide";

let guide: ReturnType<typeof useAlignmentGuide>;
let store: ReturnType<typeof useStoreApi>;

const Probe = () => {
  guide = useAlignmentGuide();
  store = useStoreApi();
  return null;
};

const event = {} as ReactMouseEvent;

const entity = (id: string, x: number, y = 0): Node => ({
  id,
  type: "entity",
  position: { x, y },
  width: 100,
  height: 50,
  data: {},
});

const renderDiagram = (nodes: Node[]) => {
  render(
    <ReactFlowProvider>
      <Probe />
    </ReactFlowProvider>,
  );
  act(() => store.getState().setNodes(nodes));
};

describe("useAlignmentGuide", () => {
  // React Flow passes no node when the one pressed moves with a selected
  // parent -- an attribute of a selected entity -- rather than being dragged
  it("takes a drag that has no dragged node of its own in its stride", () => {
    render(
      <ReactFlowProvider>
        <Probe />
      </ReactFlowProvider>,
    );
    const group = [{ id: "0", position: { x: 0, y: 0 }, data: {} }] as Node[];
    const missing = undefined as unknown as Node;

    expect(() =>
      act(() => {
        guide.onNodeDragStart(event, missing, group);
        guide.onNodeDrag(event, missing, group);
        guide.onNodeDragStop(event, missing, group);
      }),
    ).not.toThrow();
    expect(guide.guides).toEqual([]);
  });

  it("measures the gap on either side of a node centred between two others", () => {
    const [a, b, c] = [entity("a", 0), entity("b", 140), entity("c", 280)];
    renderDiagram([a, b, c]);

    act(() => guide.onNodeDrag(event, b, [b]));

    expect(guide.guides.filter((line) => line.kind === "spacing")).toEqual([
      expect.objectContaining({ x1: 100, x2: 140, label: "40" }),
      expect.objectContaining({ x1: 240, x2: 280, label: "40" }),
    ]);
  });

  // the selection moves as one, but the store still has the rest of it where
  // it was a frame ago -- close enough to the node to guide it the whole drag
  it("is not guided by the rest of a selection dragged along with it", () => {
    const [a, b, c] = [entity("a", 0), entity("b", 140), entity("c", 280)];
    renderDiagram([a, b, c]);
    const nudged = (n: Node) => entity(n.id, n.position.x + 2, 2);

    act(() =>
      guide.onNodeDrag(event, nudged(b), [nudged(a), nudged(b), nudged(c)]),
    );

    expect(guide.guides).toEqual([]);
  });
});
