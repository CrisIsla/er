import { Node } from "reactflow";
import { toErJSONNodes } from "../../../src/app/hooks/useJSON";
import {
  DEFAULT_AGGREGATION_SIZE,
  readNodeSize,
} from "../../../src/app/util/nodeSize";
import {
  RebuildNode,
  incomingLayout,
  mergeRebuiltNodes,
} from "../../../src/app/util/rebuildNodes";

const node = (
  id: string,
  erId: string,
  extra: Partial<RebuildNode> = {},
): RebuildNode => ({
  id,
  data: { erId },
  position: { x: 0, y: 0 },
  ...extra,
});

/** An aggregation container as erToReactflowElements builds one. */
const container = (id: string, erId: string): RebuildNode =>
  node(id, erId, {
    ...DEFAULT_AGGREGATION_SIZE,
    style: { ...DEFAULT_AGGREGATION_SIZE },
  });

const merge = (input: Partial<Parameters<typeof mergeRebuiltNodes>[0]> = {}) =>
  mergeRebuiltNodes({
    oldNodes: [],
    newNodes: [],
    incoming: null,
    attributeIds: new Set<string>(),
    attributesStartHidden: false,
    renaming: false,
    ...input,
  });

describe("incomingLayout", () => {
  it("indexes positions by id", () => {
    const layout = incomingLayout([{ id: "0", position: { x: 5, y: 7 } }])!;
    expect(layout.positions.get("0")).toEqual({ x: 5, y: 7 });
  });

  // every file written before sizes existed, and all five bundled examples
  it("records no size for a record that carries none", () => {
    const layout = incomingLayout([{ id: "0", position: { x: 0, y: 0 } }])!;
    expect(layout.sizes.has("0")).toBe(false);
  });

  it("drops a malformed size rather than passing it on", () => {
    const layout = incomingLayout([
      // the diagram document is untyped server-side, so this is reachable
      { id: "0", position: { x: 0, y: 0 }, width: -3, height: 100 },
      { id: "1", position: { x: 0, y: 0 }, width: 300, height: 200 },
    ])!;
    expect(layout.sizes.has("0")).toBe(false);
    expect(layout.sizes.get("1")).toEqual({ width: 300, height: 200 });
  });

  it("is null when nothing arrived", () => {
    expect(incomingLayout(null)).toBeNull();
  });
});

describe("mergeRebuiltNodes", () => {
  it("keeps the position of a node that survived the edit", () => {
    const merged = merge({
      oldNodes: [node("0", "entity: A", { position: { x: 40, y: 90 } })],
      newNodes: [node("0", "entity: A")],
    });
    expect(merged[0].position).toEqual({ x: 40, y: 90 });
  });

  it("keeps the size of a container that survived the edit", () => {
    const resized = container("0", "entity: Agg");
    const merged = merge({
      oldNodes: [
        { ...resized, width: 720, style: { width: 720, height: 480 } },
      ],
      newNodes: [resized],
    });
    expect(readNodeSize(merged[0])).toEqual({ width: 720, height: 480 });
    expect(merged[0].width).toBe(720);
  });

  it("recognises a renamed node by id when the counts are unchanged", () => {
    const merged = merge({
      oldNodes: [node("0", "entity: Old", { position: { x: 10, y: 20 } })],
      newNodes: [node("0", "entity: New")],
      renaming: true,
    });
    expect(merged).toHaveLength(1);
    expect(merged[0].position).toEqual({ x: 10, y: 20 });
  });

  it("drops a node the edit removed", () => {
    const merged = merge({
      oldNodes: [node("0", "entity: Gone")],
      newNodes: [node("0", "entity: Other")],
    });
    expect(merged.map((n) => n.data.erId)).toEqual(["entity: Other"]);
  });

  it("lets a stored size beat the one the node already had", () => {
    const merged = merge({
      oldNodes: [
        {
          ...container("0", "entity: Agg"),
          style: { width: 720, height: 480 },
        },
      ],
      newNodes: [container("0", "entity: Agg")],
      incoming: incomingLayout([
        { id: "0", position: { x: 0, y: 0 }, width: 300, height: 200 },
      ]),
    });
    expect(readNodeSize(merged[0])).toEqual({ width: 300, height: 200 });
  });

  // loading a file that predates stored sizes must not reset the diagram
  it("leaves the existing size alone when the stored record has none", () => {
    const merged = merge({
      oldNodes: [
        {
          ...container("0", "entity: Agg"),
          style: { width: 720, height: 480 },
        },
      ],
      newNodes: [container("0", "entity: Agg")],
      incoming: incomingLayout([{ id: "0", position: { x: 0, y: 0 } }]),
    });
    expect(readNodeSize(merged[0])).toEqual({ width: 720, height: 480 });
  });

  it("gives a brand-new container the generator's box", () => {
    const merged = merge({ newNodes: [container("0", "entity: Agg")] });
    expect(readNodeSize(merged[0])).toEqual(DEFAULT_AGGREGATION_SIZE);
  });

  it("gives a brand-new container a stored box when one arrived", () => {
    const merged = merge({
      newNodes: [container("0", "entity: Agg")],
      incoming: incomingLayout([
        { id: "0", position: { x: 1, y: 2 }, width: 640, height: 400 },
      ]),
    });
    expect(readNodeSize(merged[0])).toEqual({ width: 640, height: 400 });
    expect(merged[0].position).toEqual({ x: 1, y: 2 });
  });

  /**
   * The size carry is not aggregation-specific, and it must not become so by
   * accident: an entity that React Flow merely measured has no authored size,
   * so nothing is written to it and its label keeps sizing it.
   */
  it("never promotes a measurement into an authored size", () => {
    const measured = node("0", "entity: A", { width: 137, height: 44 });
    const merged = merge({
      oldNodes: [measured],
      newNodes: [node("0", "entity: A")],
    });
    expect(merged[0].style?.width).toBeUndefined();
    expect(readNodeSize(merged[0])).toBeNull();
  });

  it("hides attributes that should start hidden", () => {
    const merged = merge({
      newNodes: [node("0", "entity-attr: A|x"), node("1", "entity: A")],
      attributeIds: new Set(["0"]),
      attributesStartHidden: true,
    });
    expect(merged.map((n) => n.hidden)).toEqual([true, undefined]);
  });

  it("does not mutate the nodes it is given", () => {
    const oldNodes = [node("0", "entity: A", { position: { x: 5, y: 5 } })];
    const newNodes = [container("0", "entity: A")];
    const before = JSON.stringify({ oldNodes, newNodes });
    merge({ oldNodes, newNodes });
    expect(JSON.stringify({ oldNodes, newNodes })).toBe(before);
  });
});

describe("save and load round trip", () => {
  it("returns a resized container to exactly the same box", () => {
    const saved = [
      { ...container("0", "entity: Agg"), style: { width: 640, height: 400 } },
      node("1", "entity: A", {
        position: { x: 12, y: 34 },
        width: 90,
        height: 44,
      }),
    ];

    const file = toErJSONNodes(saved as unknown as Node[]);
    const loaded = merge({
      oldNodes: [],
      newNodes: [container("0", "entity: Agg"), node("1", "entity: A")],
      incoming: incomingLayout(file),
    });

    expect(toErJSONNodes(loaded as unknown as Node[])).toEqual(file);
  });

  it("writes no size for a node nobody sized", () => {
    const file = toErJSONNodes([
      node("0", "entity: A", { width: 137, height: 44 }),
    ] as unknown as Node[]);
    expect(file).toEqual([{ id: "0", position: { x: 0, y: 0 } }]);
  });
});
