import { Node } from "reactflow";
import * as Y from "yjs";
import { Layout } from "../../../src/app/util/layoutHistory";
import {
  publishLayout,
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

describe("publishLayout", () => {
  const at = (x: number, y: number, size: Layout["size"] = null): Layout => ({
    position: { x, y },
    size,
    parent: null,
  });
  const entity = (id: string, erId: string, x: number, y: number) =>
    node(id, x, y, { type: "entity", data: { label: erId, erId } });

  it("finds a node by what it is, whichever id it has now", () => {
    // a code edit since moved entity B from id "1" to id "2"
    const { ydoc, yNodesMap } = sharedDiagram([
      entity("0", "entity: Z", 0, 0),
      entity("1", "entity: A", 0, 0),
      entity("2", "entity: B", 100, 0),
    ]);
    publishLayout(ydoc, yNodesMap, new Map([["entity|entity: B", at(5, 6)]]));
    expect(yNodesMap.get("2")!.position).toEqual({ x: 5, y: 6 });
    expect(yNodesMap.get("1")!.position).toEqual({ x: 0, y: 0 });
  });

  it("writes an authored size into both channels", () => {
    const { ydoc, yNodesMap } = sharedDiagram([
      node("0", 0, 0, {
        type: "aggregation",
        data: { label: "G", erId: "entity: G" },
        width: 400,
        height: 300,
        style: { width: 400, height: 300 },
      }),
    ]);
    publishLayout(
      ydoc,
      yNodesMap,
      new Map([
        ["aggregation|entity: G", at(0, 0, { width: 250, height: 200 })],
      ]),
    );
    expect(yNodesMap.get("0")).toMatchObject({
      width: 250,
      height: 200,
      style: { width: 250, height: 200 },
    });
  });

  it("publishes every layout in one transaction", () => {
    const { ydoc, yNodesMap } = sharedDiagram([
      entity("0", "entity: A", 0, 0),
      entity("1", "entity: B", 100, 0),
    ]);
    let transactions = 0;
    yNodesMap.observe(() => transactions++);
    publishLayout(
      ydoc,
      yNodesMap,
      new Map([
        ["entity|entity: A", at(1, 1)],
        ["entity|entity: B", at(2, 2)],
      ]),
    );
    expect(transactions).toBe(1);
  });

  it("writes nothing for a node already laid out that way", () => {
    const { ydoc, yNodesMap } = sharedDiagram([entity("0", "entity: A", 3, 4)]);
    let transactions = 0;
    yNodesMap.observe(() => transactions++);
    publishLayout(ydoc, yNodesMap, new Map([["entity|entity: A", at(3, 4)]]));
    expect(transactions).toBe(0);
  });

  it("given where the nodes started, leaves one somebody has moved since", () => {
    const { ydoc, yNodesMap } = sharedDiagram([
      entity("0", "entity: A", 0, 0),
      entity("1", "entity: B", 300, 300), // a peer moved B from (100, 0)
    ]);
    publishLayout(
      ydoc,
      yNodesMap,
      new Map([
        ["entity|entity: A", at(10, 10)],
        ["entity|entity: B", at(110, 10)],
      ]),
      new Map([
        ["entity|entity: A", at(0, 0)],
        ["entity|entity: B", at(100, 0)],
      ]),
    );
    expect(yNodesMap.get("0")!.position).toEqual({ x: 10, y: 10 });
    expect(yNodesMap.get("1")!.position).toEqual({ x: 300, y: 300 });
  });

  it("does not publish this editor's selection", () => {
    const { ydoc, yNodesMap } = sharedDiagram([
      node("0", 0, 0, {
        type: "entity",
        data: { label: "A", erId: "entity: A" },
        selected: true,
      }),
    ]);
    publishLayout(ydoc, yNodesMap, new Map([["entity|entity: A", at(9, 9)]]));
    expect(yNodesMap.get("0")).not.toHaveProperty("selected");
  });
});
