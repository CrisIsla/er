import { Node } from "reactflow";
import * as Y from "yjs";
import {
  publishPositions,
  toSharedNode,
  withLocalSelection,
} from "../../../src/app/util/sharedNodes";

const node = (
  id: string,
  x: number,
  y: number,
  extra: Partial<Node> = {},
): Node => ({ id, position: { x, y }, data: { label: id }, ...extra });

/** A shared diagram holding `nodes`, as ErDiagramColab's yNodesMap. */
const sharedDiagram = (nodes: Node[]) => {
  const ydoc = new Y.Doc();
  const yNodesMap = ydoc.getMap<Node>("nodesMap");
  for (const n of nodes) yNodesMap.set(n.id, n);
  return { ydoc, yNodesMap };
};

describe("toSharedNode", () => {
  it("leaves this editor's selection out", () => {
    expect(
      toSharedNode(node("a", 1, 2, { selected: true })),
    ).not.toHaveProperty("selected");
  });

  it("keeps everything else", () => {
    const original = node("a", 1, 2, { selected: true, width: 90, height: 40 });
    expect(toSharedNode(original)).toEqual({
      id: "a",
      position: { x: 1, y: 2 },
      data: { label: "a" },
      width: 90,
      height: 40,
    });
    // and does not touch the node it was given
    expect(original.selected).toBe(true);
  });
});

describe("withLocalSelection", () => {
  it("keeps what this editor had selected", () => {
    const shared = [node("a", 0, 0), node("b", 0, 0), node("c", 0, 0)];
    const local = [
      node("a", 0, 0, { selected: true }),
      node("b", 0, 0),
      node("c", 0, 0, { selected: true }),
    ];
    const selected = withLocalSelection(shared, local)
      .filter((n) => n.selected)
      .map((n) => n.id);
    expect(selected).toEqual(["a", "c"]);
  });

  it("ignores a selection that arrived with the shared nodes", () => {
    // published by an editor from before selections were kept local
    const shared = [node("a", 0, 0, { selected: true })];
    expect(withLocalSelection(shared, [node("a", 0, 0)])[0].selected).toBe(
      false,
    );
  });

  it("takes everything but the selection from the shared nodes", () => {
    const [a] = withLocalSelection(
      [node("a", 50, 60)],
      [node("a", 0, 0, { selected: true })],
    );
    expect(a.position).toEqual({ x: 50, y: 60 });
    expect(a.selected).toBe(true);
  });
});

describe("publishPositions", () => {
  it("publishes every node a drag moved, not just the one under the pointer", () => {
    const { ydoc, yNodesMap } = sharedDiagram([
      node("a", 0, 0),
      node("b", 100, 0),
      node("c", 200, 0),
    ]);

    publishPositions(ydoc, yNodesMap, [node("a", 10, 5), node("b", 110, 5)]);

    expect(yNodesMap.get("a")!.position).toEqual({ x: 10, y: 5 });
    expect(yNodesMap.get("b")!.position).toEqual({ x: 110, y: 5 });
    expect(yNodesMap.get("c")!.position).toEqual({ x: 200, y: 0 });
  });

  it("lands every position before anyone observing the map hears of it", () => {
    // ErDiagramColab's observer replaces the local nodes with the shared ones:
    // run after only the first write, it would pull the rest of the group back
    const { ydoc, yNodesMap } = sharedDiagram([
      node("a", 0, 0),
      node("b", 100, 0),
    ]);
    const seen: Record<string, number>[] = [];
    yNodesMap.observe(() =>
      seen.push(
        Object.fromEntries(
          Array.from(yNodesMap.values()).map((n) => [n.id, n.position.x]),
        ),
      ),
    );

    publishPositions(ydoc, yNodesMap, [node("a", 10, 0), node("b", 110, 0)]);

    expect(seen).toEqual([{ a: 10, b: 110 }]);
  });

  it("does not publish the selection the drag leaves behind", () => {
    const { ydoc, yNodesMap } = sharedDiagram([node("a", 0, 0)]);
    publishPositions(ydoc, yNodesMap, [node("a", 10, 0, { selected: true })]);
    expect(yNodesMap.get("a")).not.toHaveProperty("selected");
  });

  it("keeps the rest of what is shared about the node", () => {
    const { ydoc, yNodesMap } = sharedDiagram([
      node("a", 0, 0, { width: 90, height: 40, parentNode: "p" }),
    ]);
    publishPositions(ydoc, yNodesMap, [node("a", 10, 0)]);
    expect(yNodesMap.get("a")).toMatchObject({
      width: 90,
      height: 40,
      parentNode: "p",
      position: { x: 10, y: 0 },
    });
  });

  it("leaves out a node the shared diagram does not have", () => {
    const { ydoc, yNodesMap } = sharedDiagram([node("a", 0, 0)]);
    publishPositions(ydoc, yNodesMap, [node("gone", 10, 0)]);
    expect(yNodesMap.has("gone")).toBe(false);
  });

  it("does not rewrite a node already there, as a click would", () => {
    const { ydoc, yNodesMap } = sharedDiagram([
      node("a", 0, 0),
      node("b", 100, 0),
    ]);
    let writes = 0;
    yNodesMap.observe((event) => (writes += event.keysChanged.size));
    publishPositions(ydoc, yNodesMap, [node("a", 0, 0), node("b", 120, 0)]);
    expect(writes).toBe(1);
  });
});
