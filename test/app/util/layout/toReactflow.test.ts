/**
 * What the React Flow adapter tells the layout about each node's size.
 *
 * The bug this pins: with the attributes hidden, the same diagram used to lay
 * out three different ways depending on what had been on screen before. React
 * Flow never measures a hidden node, and it carries a node's measured size
 * forward *by id* -- and this app's ids are array indices, which every diagram
 * reuses. So a hidden attribute was wearing nothing, or the size it had when it
 * was last drawn, or the size of whatever another diagram had drawn at its id;
 * and the arranging stage reads every attribute's size, drawn or not.
 *
 * jsdom lays nothing out, so on its own it plays a host where nothing can be
 * measured. The second half stands in for a browser by measuring the probes
 * (util/attributeShape.ts) exactly as the fixtures size a drawn attribute.
 */

import { Edge, Node } from "reactflow";
import company from "../../../../src/app/static/examples/company.json";
import { ATTRIBUTE_PROBE_ATTRIBUTE } from "../../../../src/app/util/attributeShape";
import { isAttributeNode } from "../../../../src/app/util/erGraph";
import { layoutDiscreteSearch } from "../../../../src/app/util/layout";
import { LayoutInputNode } from "../../../../src/app/util/layout/buildLayoutGraph";
import {
  DEFAULT_LAYOUT_PARAMS,
  LayoutParams,
} from "../../../../src/app/util/layout/params";
import {
  getDiscreteLayoutedElements,
  layoutSizeOf,
  sizedForLayout,
} from "../../../../src/app/util/layout/toReactflow";
import { fromErDoc, sizeOf } from "./fixtures";

type Positions = Map<string, { x: number; y: number }>;

const STRUCTURAL = ["entity", "relationship", "isA"];

const { nodes: built, edges } = fromErDoc(company.erDoc);

const withAttributes = (change: (node: LayoutInputNode) => LayoutInputNode) =>
  built.map((node) => (isAttributeNode(node) ? change(node) : node));

/** hidden from the start, so React Flow never measured them */
const neverDrawn = withAttributes((node) => ({
  ...node,
  hidden: true,
  width: undefined,
  height: undefined,
}));

/** measured while they were drawn, then hidden: the sizes they really have */
const drawnThenHidden = withAttributes((node) => ({ ...node, hidden: true }));

/** hidden, and wearing what another diagram drew at their ids */
const leftovers = withAttributes((node) => ({
  ...node,
  hidden: true,
  width: 240,
  height: 95,
}));

const shown = built;

/** Where the adapter puts every node. */
const adapter = async (nodes: LayoutInputNode[], params?: LayoutParams) => {
  const laidOut = await getDiscreteLayoutedElements(
    nodes as unknown as Node[],
    edges as Edge[],
    params,
  );
  return new Map(laidOut.map((node) => [node.id, node.position])) as Positions;
};

/** Where the layout puts every node when it is handed these sizes as they are. */
const raw = (nodes: LayoutInputNode[], params?: LayoutParams): Positions =>
  layoutDiscreteSearch(
    nodes,
    edges.map(({ id, source, target }) => ({ id, source, target })),
    params,
  ).positions;

/** Only what the diagram is arranged from: entities, diamonds and triangles. */
const structural = (positions: Positions): Positions =>
  new Map(
    [...positions].filter(([id]) =>
      STRUCTURAL.includes(built.find((node) => node.id === id)?.type ?? ""),
    ),
  );

describe("getDiscreteLayoutedElements, where nothing can be measured", () => {
  it("lays hidden attributes out the same, whatever size they were left wearing", async () => {
    // the leftovers really do move the diagram when they are believed -- or
    // agreeing below would prove nothing
    expect(structural(raw(leftovers))).not.toEqual(structural(raw(neverDrawn)));

    const expected = await adapter(neverDrawn);
    expect(await adapter(leftovers)).toEqual(expected);
    expect(await adapter(drawnThenHidden)).toEqual(expected);
  });
});

describe("getDiscreteLayoutedElements, in a browser", () => {
  const measured = (element: HTMLElement) =>
    element.hasAttribute(ATTRIBUTE_PROBE_ATTRIBUTE)
      ? sizeOf({
          type: "entity-attribute",
          data: { label: element.textContent ?? "" },
        })
      : { width: 0, height: 0 };

  // every probe measures what the fixtures say an attribute with its label
  // measures when drawn; everything else keeps jsdom's zero
  beforeEach(() => {
    jest
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return measured(this).width;
      });
    jest
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return measured(this).height;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sizes every attribute from its label, however it came to be hidden", async () => {
    const expected = raw(drawnThenHidden);
    expect(await adapter(neverDrawn)).toEqual(expected);
    expect(await adapter(leftovers)).toEqual(expected);
    expect(await adapter(drawnThenHidden)).toEqual(expected);
  });

  it("lays a diagram with its attributes shown out as it always has", async () => {
    expect(await adapter(shown)).toEqual(raw(shown));
  });

  it("arranges the hidden view exactly as the shown one while the gaps are held open", async () => {
    const held: LayoutParams = {
      ...DEFAULT_LAYOUT_PARAMS,
      spacing: { ...DEFAULT_LAYOUT_PARAMS.spacing, closeHiddenGaps: false },
    };
    const asShown = structural(await adapter(shown, held));
    const asHidden = structural(await adapter(neverDrawn, held));

    // relative to one another, not to the origin: the diagram is shifted into
    // the positive quadrant by a margin read off everything placed, and hidden
    // attributes are placed differently from drawn ones
    const [anchor] = [...asShown.keys()].sort();
    const offset = {
      x: asHidden.get(anchor)!.x - asShown.get(anchor)!.x,
      y: asHidden.get(anchor)!.y - asShown.get(anchor)!.y,
    };
    for (const [id, position] of asShown) {
      expect(asHidden.get(id)!.x - offset.x).toBeCloseTo(position.x, 6);
      expect(asHidden.get(id)!.y - offset.y).toBeCloseTo(position.y, 6);
    }
    expect(asShown.size).toBeGreaterThan(0);
  });
});

describe("layoutSizeOf", () => {
  const shapes = new Map([["name", { width: 76, height: 44 }]]);
  const node = (extra: Partial<Node>): Node => ({
    id: "1",
    type: "entity-attribute",
    position: { x: 0, y: 0 },
    data: { label: "name" },
    ...extra,
  });

  it("takes an attribute's size from its label, drawn or hidden", () => {
    const wearing = { width: 300, height: 90 };
    expect(layoutSizeOf(node(wearing), shapes)).toEqual({
      width: 76,
      height: 44,
    });
    expect(layoutSizeOf(node({ ...wearing, hidden: true }), shapes)).toEqual({
      width: 76,
      height: 44,
    });
  });

  it("never believes the size a hidden node is wearing", () => {
    const size = layoutSizeOf(
      node({ hidden: true, width: 300, height: 90 }),
      new Map(),
    );
    expect(size).toEqual({ width: undefined, height: undefined });
  });

  it("keeps a size somebody chose for a hidden node", () => {
    expect(
      layoutSizeOf(
        node({
          type: "aggregation",
          hidden: true,
          width: 300,
          height: 90,
          style: { width: 640, height: 480 },
        }),
        new Map(),
      ),
    ).toEqual({ width: 640, height: 480 });
  });

  it("believes what React Flow measured of a node it draws", () => {
    // labelled like a measured attribute, to show the label is not what decides
    expect(
      layoutSizeOf(node({ type: "entity", width: 104, height: 44 }), shapes),
    ).toEqual({ width: 104, height: 44 });
  });
});

describe("sizedForLayout", () => {
  const hiddenAttribute: Node = {
    id: "2",
    type: "entity-attribute",
    hidden: true,
    width: 116,
    height: 44,
    position: { x: 0, y: 0 },
    data: { label: "name" },
  };

  // ELK throws on `width: undefined` where it defaults a missing width
  it("leaves out a size nobody knows, rather than setting it to undefined", () => {
    const [sized] = sizedForLayout([hiddenAttribute]);
    expect(sized).not.toHaveProperty("width");
    expect(sized).not.toHaveProperty("height");
  });

  it("copies, and leaves what it was given alone", () => {
    const [sized] = sizedForLayout([hiddenAttribute]);
    expect(sized).not.toBe(hiddenAttribute);
    expect(hiddenAttribute).toMatchObject({ width: 116, height: 44 });
  });
});
