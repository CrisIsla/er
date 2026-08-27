import { PositionedNode } from "../../../../src/app/util/alignmentCandidates";
import {
  ResizeSnapshot,
  boxForContents,
  growAggregationsToFit,
  memberRects,
  membersOf,
  minimumAggregationSize,
  resizeSnapshot,
  scaleAlong,
  scaleMembers,
} from "../../../../src/app/util/layout/aggregationBox";
import { MIN_AGGREGATION_SIZE } from "../../../../src/app/util/nodeSize";

const node = (
  id: string,
  x: number,
  y: number,
  extra: Partial<PositionedNode> = {},
): PositionedNode => ({
  id,
  type: "entity",
  position: { x, y },
  width: 200,
  height: 100,
  ...extra,
});

const PAD = 40;

describe("membersOf", () => {
  /**
   * container -> member, inner container -> grandchild. A grandchild's position
   * is relative to the inner box, so treating it as a member of the outer one
   * would move it twice.
   */
  const nodes = [
    node("outer", 0, 0, { type: "aggregation" }),
    node("member", 40, 40, { parentNode: "outer" }),
    node("inner", 300, 40, { type: "aggregation", parentNode: "outer" }),
    node("grandchild", 20, 20, { parentNode: "inner" }),
  ];

  it("returns only the direct children", () => {
    expect(membersOf(nodes, "outer").map((n) => n.id)).toEqual([
      "member",
      "inner",
    ]);
  });

  it("does not reach through a nested container", () => {
    expect(membersOf(nodes, "outer").map((n) => n.id)).not.toContain(
      "grandchild",
    );
  });

  it("does not include the container itself", () => {
    expect(membersOf(nodes, "outer").map((n) => n.id)).not.toContain("outer");
  });

  it("gives a nested container its own members", () => {
    expect(membersOf(nodes, "inner").map((n) => n.id)).toEqual(["grandchild"]);
  });
});

describe("memberRects", () => {
  it("measures a plain node at its own box", () => {
    expect(memberRects([node("a", 40, 40)])).toEqual([
      { id: "a", x: 40, y: 40, width: 200, height: 100 },
    ]);
  });

  // a diamond reports its unrotated side but covers its diagonal, so a box
  // sized from measured widths would let its corners hang over the border
  it("grows a relationship diamond to what it covers", () => {
    const [rect] = memberRects([
      node("r", 0, 0, { type: "relationship", width: 95, height: 95 }),
    ]);
    expect(rect.width).toBeCloseTo((95 + 95) / Math.SQRT2, 6);
    expect(rect.x).toBeCloseTo(47.5 - rect.width / 2, 6);
  });

  it("falls back to the per-type default when nothing measured the node", () => {
    expect(
      memberRects([{ id: "a", type: "entity", position: { x: 0, y: 0 } }]),
    ).toEqual([{ id: "a", x: 0, y: 0, width: 90, height: 44 }]);
  });

  it("gives hidden members no room", () => {
    expect(memberRects([node("a", 0, 0, { hidden: true })])).toEqual([]);
  });

  it("reads positions through the override when one is given", () => {
    const [rect] = memberRects([node("a", 40, 40)], () => ({ x: 5, y: 7 }));
    expect([rect.x, rect.y]).toEqual([5, 7]);
  });
});

describe("boxForContents", () => {
  it("puts the far edge one padding inside the box", () => {
    expect(
      boxForContents(
        [{ id: "a", x: PAD, y: PAD, width: 200, height: 100 }],
        PAD,
      ),
    ).toEqual({ width: 280, height: 180 });
  });

  it("spans every member", () => {
    expect(
      boxForContents(
        [
          { id: "a", x: PAD, y: PAD, width: 200, height: 100 },
          { id: "b", x: 300, y: PAD, width: 100, height: 60 },
        ],
        PAD,
      ),
    ).toEqual({ width: 440, height: 180 });
  });

  it("falls back to the default box when there is nothing to hold", () => {
    expect(boxForContents([], PAD)).toEqual({ width: 500, height: 500 });
  });
});

describe("minimumAggregationSize", () => {
  const container = node("agg", 0, 0, { type: "aggregation" });

  it("is the contents plus padding", () => {
    const nodes = [container, node("a", PAD, PAD, { parentNode: "agg" })];
    expect(minimumAggregationSize(nodes, "agg", PAD)).toEqual({
      width: 280,
      height: 180,
    });
  });

  it("grows when a member moves outward", () => {
    const before = minimumAggregationSize(
      [container, node("a", PAD, PAD, { parentNode: "agg" })],
      "agg",
      PAD,
    );
    const after = minimumAggregationSize(
      [container, node("a", PAD + 200, PAD, { parentNode: "agg" })],
      "agg",
      PAD,
    );
    expect(after.width - before.width).toBe(200);
    expect(after.height).toBe(before.height);
  });

  it("ignores hidden members", () => {
    const nodes = [
      container,
      node("a", PAD, PAD, { parentNode: "agg" }),
      node("ghost", 4000, 4000, { parentNode: "agg", hidden: true }),
    ];
    expect(minimumAggregationSize(nodes, "agg", PAD)).toEqual({
      width: 280,
      height: 180,
    });
  });

  it("stays grabbable when there is nothing visible inside", () => {
    expect(minimumAggregationSize([container], "agg", PAD)).toEqual(
      MIN_AGGREGATION_SIZE,
    );
  });

  it("never returns less than the sanity floor", () => {
    const nodes = [
      container,
      node("a", 0, 0, { parentNode: "agg", width: 20, height: 10 }),
    ];
    const min = minimumAggregationSize(nodes, "agg", 0);
    expect(min.width).toBeGreaterThanOrEqual(MIN_AGGREGATION_SIZE.width);
    expect(min.height).toBeGreaterThanOrEqual(MIN_AGGREGATION_SIZE.height);
  });
});

describe("scaleAlong", () => {
  // no padding and a 100-wide member in a 500 box: the travel range is 0..400
  const grow = (start: number) => scaleAlong(start, 100, 500, 1000, 0);

  it("returns the coordinate untouched when the box did not change", () => {
    // exactly, so an edge-handle drag cannot nudge the other axis
    expect(scaleAlong(137.4, 100, 500, 500, 12)).toBe(137.4);
  });

  it("keeps a member flush at the leading edge", () => {
    expect(grow(0)).toBe(0);
  });

  it("keeps a member flush at the trailing edge", () => {
    expect(grow(400)).toBe(900);
  });

  it("keeps a centred member centred", () => {
    expect(grow(200)).toBe(450);
  });

  it("respects the padding on both sides", () => {
    expect(scaleAlong(12, 100, 500, 1000, 12)).toBe(12);
    expect(scaleAlong(500 - 12 - 100, 100, 500, 1000, 12)).toBe(
      1000 - 12 - 100,
    );
  });

  it("shrinking undoes growing", () => {
    for (const start of [0, 37, 200, 399.5, 400]) {
      expect(scaleAlong(grow(start), 100, 1000, 500, 0)).toBeCloseTo(start, 9);
    }
  });

  it("centres a member the new box cannot hold", () => {
    // 300-wide member, 200-wide box: overflow 50px on each side, not 100 on one
    expect(scaleAlong(10, 300, 500, 200, 0)).toBe(-50);
  });

  it("centres a member the old box could not hold either", () => {
    const result = scaleAlong(10, 300, 250, 1000, 0);
    expect(Number.isFinite(result)).toBe(true);
    expect(result).toBe(350);
  });

  it("stays finite when the box is smaller than its own padding", () => {
    expect(Number.isFinite(scaleAlong(10, 50, 500, 10, 40))).toBe(true);
  });

  it("clamps a member that started outside the padded area", () => {
    expect(scaleAlong(-100, 100, 500, 1000, 12)).toBe(12);
  });
});

describe("scaleMembers", () => {
  const snapshot: ResizeSnapshot = {
    width: 500,
    height: 500,
    padding: 0,
    members: [
      { id: "a", x: 0, y: 0, width: 100, height: 100 },
      { id: "b", x: 400, y: 200, width: 100, height: 100 },
    ],
  };

  it("moves both axes independently", () => {
    expect(scaleMembers(snapshot, { width: 1000, height: 500 })).toEqual([
      { id: "a", position: { x: 0, y: 0 } },
      { id: "b", position: { x: 900, y: 200 } },
    ]);
  });

  it("leaves the untouched axis bit-identical on an edge-handle drag", () => {
    const moved = scaleMembers(snapshot, { width: 1000, height: 500 });
    expect(moved.map((m) => m.position.y)).toEqual(
      snapshot.members.map((m) => m.y),
    );
  });

  /**
   * Every tick is a pure function of the drag-start snapshot, so no number of
   * intermediate sizes can accumulate drift and a drag that wanders and comes
   * back leaves the contents exactly where they started.
   */
  it("does not drift across a long drag", () => {
    for (let width = 500; width >= 200; width -= 3)
      scaleMembers(snapshot, { width, height: 500 });
    for (let width = 200; width <= 500; width += 3)
      scaleMembers(snapshot, { width, height: 500 });

    expect(scaleMembers(snapshot, { width: 500, height: 500 })).toEqual([
      { id: "a", position: { x: 0, y: 0 } },
      { id: "b", position: { x: 400, y: 200 } },
    ]);
  });

  it("does not mutate the snapshot", () => {
    const before = JSON.stringify(snapshot);
    scaleMembers(snapshot, { width: 137, height: 942 });
    expect(JSON.stringify(snapshot)).toBe(before);
  });

  it("returns nothing for an empty container", () => {
    expect(
      scaleMembers({ ...snapshot, members: [] }, { width: 900, height: 900 }),
    ).toEqual([]);
  });
});

describe("resizeSnapshot", () => {
  const nodes = [
    node("agg", 0, 0, { type: "aggregation" }),
    node("a", 40, 40, { parentNode: "agg" }),
    node("ghost", 80, 80, { parentNode: "agg", hidden: true }),
    node("outside", 0, 0),
  ];

  /**
   * Unlike the sizing rule, the transform moves hidden members too: one left
   * behind would pop into the wrong place the moment it is revealed.
   */
  it("includes hidden members", () => {
    const snapshot = resizeSnapshot(nodes, "agg", { width: 500, height: 500 });
    expect(snapshot.members.map((m) => m.id)).toEqual(["a", "ghost"]);
  });

  it("records the box it was taken at", () => {
    const snapshot = resizeSnapshot(nodes, "agg", { width: 640, height: 480 });
    expect([snapshot.width, snapshot.height]).toEqual([640, 480]);
  });

  it("carries no container position, so it cannot be applied twice", () => {
    expect(
      resizeSnapshot(nodes, "agg", { width: 500, height: 500 }),
    ).not.toHaveProperty("position");
  });
});

describe("growAggregationsToFit", () => {
  /** A container as the app stores one: an authored size in `style`. */
  const sized = (id: string, width: number, height: number, extra = {}) =>
    ({
      ...(node(id, 0, 0, {
        type: "aggregation",
        width,
        height,
        ...extra,
      }) as PositionedNode),
      style: { width, height },
    }) as PositionedNode & { style: { width: number; height: number } };

  /** A member as the generator makes one: no authored size, so sized by type. */
  const member = (id: string, x: number, y: number, parentNode: string) =>
    node(id, x, y, { parentNode }) as PositionedNode;

  // entity default, since a plain member carries no authored size
  const NOMINAL = 90;

  it("grows a container whose member no longer fits", () => {
    const grown = growAggregationsToFit(
      [sized("agg", 300, 300), member("a", 200, 40, "agg")],
      PAD,
    );
    // the member reaches 200 + 90, so the box needs that plus one padding;
    // the height already fits, and grow never shrinks
    expect(grown.get("agg")).toEqual({
      width: 200 + NOMINAL + PAD,
      height: 300,
    });
  });

  it("writes nothing when everything already fits", () => {
    const grown = growAggregationsToFit(
      [sized("agg", 900, 900), member("a", PAD, PAD, "agg")],
      PAD,
    );
    expect(grown.size).toBe(0);
  });

  // a box the user made roomy stays roomy; shrinking it is the layout's job
  it("never shrinks a container", () => {
    const nodes = [sized("agg", 900, 900), member("a", PAD, PAD, "agg")];
    expect(growAggregationsToFit(nodes, PAD).has("agg")).toBe(false);
  });

  it("grows one axis without touching the other", () => {
    const grown = growAggregationsToFit(
      [sized("agg", 300, 900), member("a", 200, 40, "agg")],
      PAD,
    );
    expect(grown.get("agg")).toEqual({
      width: 200 + NOMINAL + PAD,
      height: 900,
    });
  });

  /**
   * React Flow carries a measured size forward by id, and this app's ids shift
   * on every edit -- so right after a rebuild a node can be wearing the
   * dimensions of whatever used to hold its id. Growing must not believe them.
   */
  it("ignores a member's measured size", () => {
    const grown = growAggregationsToFit(
      [
        sized("agg", 300, 300),
        // as if this node had inherited an aggregation's 900x900 measurement
        node("a", PAD, PAD, {
          parentNode: "agg",
          width: 900,
          height: 900,
        }) as PositionedNode,
      ],
      PAD,
    );
    expect(grown.size).toBe(0);
  });

  it("trusts an authored size, which is carried by identity", () => {
    const grown = growAggregationsToFit(
      [
        sized("agg", 300, 300),
        {
          ...sized("inner", 600, 200),
          position: { x: PAD, y: PAD },
          parentNode: "agg",
        },
      ],
      PAD,
    );
    expect(grown.get("agg")).toEqual({ width: PAD + 600 + PAD, height: 300 });
  });

  it("is idempotent", () => {
    const nodes = [sized("agg", 300, 300), member("a", 200, 40, "agg")];
    const once = growAggregationsToFit(nodes, PAD);
    const applied = nodes.map((n) => {
      const size = once.get(n.id);
      return size === undefined ? n : { ...n, ...size, style: { ...size } };
    });
    expect(growAggregationsToFit(applied, PAD).size).toBe(0);
  });

  /**
   * Deepest first: the outer box has to be told how big the inner one became,
   * not how big it used to be.
   */
  it("grows an inner container before the box that holds it", () => {
    const grown = growAggregationsToFit(
      [
        sized("outer", 300, 300),
        {
          ...sized("inner", 300, 300),
          position: { x: PAD, y: PAD },
          parentNode: "outer",
        },
        member("a", 400, 40, "inner"),
      ],
      PAD,
    );

    const inner = grown.get("inner")!;
    const outer = grown.get("outer")!;
    expect(inner.width).toBe(400 + NOMINAL + PAD);
    // the outer box holds the inner one, at its new width, plus padding
    expect(outer.width).toBe(PAD + inner.width + PAD);
  });

  it("ignores a diagram with no aggregations", () => {
    expect(growAggregationsToFit([node("a", 0, 0)], PAD).size).toBe(0);
  });
});
