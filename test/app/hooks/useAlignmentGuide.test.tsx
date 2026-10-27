import { act, render } from "@testing-library/react";
import { MouseEvent as ReactMouseEvent } from "react";
import { Node, ReactFlowProvider, useStoreApi } from "reactflow";
import { useAlignmentGuide } from "../../../src/app/hooks/useAlignmentGuide";
import {
  DiagramSettingsProvider,
  useDiagramSettings,
} from "../../../src/app/hooks/useDiagramSettings";

let guide: ReturnType<typeof useAlignmentGuide>;
let store: ReturnType<typeof useStoreApi>;
let setSetting: ReturnType<typeof useDiagramSettings>["setSetting"];

const Probe = () => {
  guide = useAlignmentGuide();
  store = useStoreApi();
  setSetting = useDiagramSettings().setSetting;
  return null;
};

const event = {} as ReactMouseEvent;

const entity = (
  id: string,
  x: number,
  y = 0,
  extra: Partial<Node> = {},
): Node => ({
  id,
  type: "entity",
  position: { x, y },
  data: {},
  width: 100,
  height: 50,
  ...extra,
});

/** Mounts the hook over a diagram of its own. */
const mount = (nodes: Node[]) => {
  render(
    <ReactFlowProvider>
      <DiagramSettingsProvider>
        <Probe />
      </DiagramSettingsProvider>
    </ReactFlowProvider>,
  );
  act(() => {
    // the store owns the nodes, so what the hook sets lands in it
    store.setState({ hasDefaultNodes: true });
    store.getState().setNodes(nodes);
  });
};

/** One move of a drag, with the nodes where the pointer has just put them. */
const dragFrame = (grabbed: Node, along: Node[] = []) =>
  act(() => guide.onNodeDrag(event, grabbed, [grabbed, ...along]));

const positionOf = (id: string) =>
  store
    .getState()
    .getNodes()
    .find((node) => node.id === id)?.position;

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

  it("snaps the node under the pointer and shifts the rest of the selection with it", () => {
    const a = entity("a", 0, 0, { selected: true });
    const b = entity("b", 0, 200, { selected: true });
    // its centre line is x = 350
    const other = entity("other", 300, 400);
    mount([a, b, other]);
    act(() => setSetting("snapEnabled", true));

    // the pointer has carried both 305 to the right: a's centre is 5px off
    dragFrame({ ...a, position: { x: 305, y: 0 } }, [
      { ...b, position: { x: 305, y: 200 } },
    ]);

    expect(positionOf("a")).toEqual({ x: 300, y: 0 });
    expect(positionOf("b")).toEqual({ x: 300, y: 200 });
    expect(guide.guides).toEqual([
      expect.objectContaining({ kind: "align", x1: 350, x2: 350 }),
    ]);
  });

  it("draws no guide to a node that moves along with the selection", () => {
    // b sits right under a, on the same centre line, and moves with it
    const a = entity("a", 0, 0, { selected: true });
    const b = entity("b", 0, 200, { selected: true });
    mount([a, b]);

    dragFrame({ ...a, position: { x: 40, y: 0 } }, [
      { ...b, position: { x: 40, y: 200 } },
    ]);

    expect(guide.guides).toEqual([]);
  });

  it("draws no guide to the members of the aggregation being dragged", () => {
    const box = entity("box", 0, 0, {
      type: "aggregation",
      width: 300,
      height: 200,
    });
    // placed relative to the box, on both of its centre lines
    const member = entity("member", 100, 75, {
      type: "relationship",
      parentNode: "box",
    });
    mount([box, member]);

    dragFrame({ ...box, position: { x: 40, y: 0 } });

    expect(guide.guides).toEqual([]);
  });

  it("measures the gap on either side of a node centred between two others", () => {
    const [a, b, c] = [entity("a", 0), entity("b", 140), entity("c", 280)];
    mount([a, b, c]);

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
    mount([a, b, c]);
    const nudged = (n: Node) => entity(n.id, n.position.x + 2, 2);

    act(() =>
      guide.onNodeDrag(event, nudged(b), [nudged(a), nudged(b), nudged(c)]),
    );

    expect(guide.guides).toEqual([]);
  });
});
