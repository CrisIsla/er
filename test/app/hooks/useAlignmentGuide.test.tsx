import { act, render } from "@testing-library/react";
import { MouseEvent as ReactMouseEvent } from "react";
import { Node, ReactFlowProvider } from "reactflow";
import { useAlignmentGuide } from "../../../src/app/hooks/useAlignmentGuide";

let guide: ReturnType<typeof useAlignmentGuide>;

const Probe = () => {
  guide = useAlignmentGuide();
  return null;
};

const event = {} as ReactMouseEvent;

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
});
