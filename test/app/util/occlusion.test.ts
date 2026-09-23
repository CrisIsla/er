import {
  Route,
  Shape,
  clipConvex,
  clipSegmentToPolygon,
  MAX_OCCLUSIONS,
  findOcclusions,
  minWidth,
  signedArea,
} from "../../../src/app/util/occlusion";
import {
  outlinePolygon,
  polygonBounds,
} from "../../../src/app/util/nodeOutline";

type Vec = { x: number; y: number };

const boxPolygon = (x: number, y: number, width: number, height: number) => [
  { x, y },
  { x: x + width, y },
  { x: x + width, y: y + height },
  { x, y: y + height },
];

const box = (
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 100,
  extra: Partial<Shape> = {},
): Shape => ({
  id,
  polygon: boxPolygon(x, y, width, height),
  occludesEdges: true,
  containerIds: [],
  ...extra,
});

/** A relationship diamond, as nodeOutline draws it: corners on the axes. */
const diamond = (id: string, cx: number, cy: number, reach: number): Shape => ({
  id,
  polygon: [
    { x: cx + reach, y: cy },
    { x: cx, y: cy + reach },
    { x: cx - reach, y: cy },
    { x: cx, y: cy - reach },
  ],
  occludesEdges: true,
  containerIds: [],
});

const route = (
  id: string,
  sourceId: string,
  targetId: string,
  ...points: Vec[]
): Route => ({ id, sourceId, targetId, points });

describe("clipConvex", () => {
  it("returns the rectangle two boxes share", () => {
    const region = clipConvex(
      boxPolygon(0, 0, 100, 100),
      boxPolygon(60, 20, 100, 100),
    );

    expect(polygonBounds(region)).toEqual({
      x: 60,
      y: 20,
      width: 40,
      height: 80,
    });
  });

  it("keeps a shape that sits wholly inside another", () => {
    const region = clipConvex(
      boxPolygon(20, 20, 20, 20),
      boxPolygon(0, 0, 100, 100),
    );

    expect(polygonBounds(region)).toEqual({
      x: 20,
      y: 20,
      width: 20,
      height: 20,
    });
  });

  it("keeps a shape clipped against itself whole, without doubling its corners", () => {
    const square = boxPolygon(0, 0, 100, 100);

    expect(clipConvex(square, square)).toHaveLength(4);
  });

  it("gives nothing for shapes that miss each other", () => {
    expect(
      clipConvex(boxPolygon(0, 0, 50, 50), boxPolygon(200, 200, 50, 50)),
    ).toEqual([]);
  });

  it("gives a flat sliver for shapes that only touch", () => {
    const region = clipConvex(
      boxPolygon(0, 0, 100, 100),
      boxPolygon(100, 0, 100, 100),
    );

    expect(minWidth(region)).toBeCloseTo(0, 6);
  });

  it("gives nothing when either shape is not a shape", () => {
    expect(clipConvex([{ x: 0, y: 0 }], boxPolygon(0, 0, 10, 10))).toEqual([]);
    expect(clipConvex(boxPolygon(0, 0, 10, 10), [])).toEqual([]);
  });
});

describe("minWidth", () => {
  it("measures the narrow side of a rectangle", () => {
    expect(minWidth(boxPolygon(0, 0, 200, 30))).toBeCloseTo(30, 6);
  });

  /**
   * The reason area is the wrong gate: this sliver covers 100 square pixels,
   * which sounds like a lot and is half a pixel of overlap.
   */
  it("sees a long sliver as narrow, whatever its area", () => {
    expect(minWidth(boxPolygon(0, 0, 200, 0.5))).toBeCloseTo(0.5, 6);
  });

  it("measures across a diamond, not along it", () => {
    // corners 50 out on each axis, so the sides are 50*sqrt(2) apart
    expect(minWidth(diamond("d", 0, 0, 50).polygon)).toBeCloseTo(
      50 * Math.SQRT2,
      6,
    );
  });
});

describe("clipSegmentToPolygon", () => {
  const square = boxPolygon(0, 0, 100, 100);

  it("returns the run of line the shape covers", () => {
    const span = clipSegmentToPolygon(
      { x: -50, y: 50 },
      { x: 150, y: 50 },
      square,
    );

    expect(span).not.toBeNull();
    expect(span![0]).toEqual({ x: 0, y: 50 });
    expect(span![1]).toEqual({ x: 100, y: 50 });
  });

  it("stops at the end of a line that finishes inside", () => {
    const span = clipSegmentToPolygon(
      { x: -50, y: 50 },
      { x: 40, y: 50 },
      square,
    );

    expect(span![0]).toEqual({ x: 0, y: 50 });
    expect(span![1]).toEqual({ x: 40, y: 50 });
  });

  it("gives nothing for a line that misses", () => {
    expect(
      clipSegmentToPolygon({ x: -50, y: 200 }, { x: 150, y: 200 }, square),
    ).toBeNull();
  });

  it("gives nothing for a line running alongside a side", () => {
    expect(
      clipSegmentToPolygon({ x: -50, y: 0 }, { x: 150, y: 0 }, square),
    ).toBeNull();
  });

  it("gives nothing for a line with no length", () => {
    expect(
      clipSegmentToPolygon({ x: 50, y: 50 }, { x: 50, y: 50 }, square),
    ).toBeNull();
  });
});

describe("findOcclusions", () => {
  describe("shapes over shapes", () => {
    it("reports a pair that overlaps, once, with the region they share", () => {
      const marks = findOcclusions([box("a", 0, 0), box("b", 60, 20)], []);

      expect(marks).toHaveLength(1);
      expect(marks[0].kind).toBe("shape");
      expect(
        polygonBounds(marks[0].kind === "shape" ? marks[0].polygon : []),
      ).toEqual({ x: 60, y: 20, width: 40, height: 80 });
    });

    it("names the pair in a stable order, whichever way round they arrive", () => {
      const forwards = findOcclusions([box("a", 0, 0), box("b", 60, 20)], []);
      const backwards = findOcclusions([box("b", 60, 20), box("a", 0, 0)], []);

      expect(forwards[0].id).toBe(backwards[0].id);
      expect(forwards[0].id).toBe("shape:a|b");
    });

    /**
     * The whole reason shapes are compared as polygons. Two diamonds this far
     * apart have overlapping *bounding boxes* and a clear gap between the
     * shapes themselves -- a false alarm on a diagram that is fine.
     */
    it("leaves two diamonds alone when only their boxes overlap", () => {
      const reach = (95 * Math.SQRT2) / 2;
      const shapes = [
        diamond("r1", 0, 0, reach),
        diamond("r2", 100, 100, reach),
      ];

      // the premise: their boxes really do overlap
      const [first, second] = shapes.map((shape) =>
        polygonBounds(shape.polygon),
      );
      expect(first.x + first.width).toBeGreaterThan(second.x);

      expect(findOcclusions(shapes, [])).toEqual([]);
    });

    /** The apex hangs below the node box, so no rectangle can see this one. */
    it("catches a box met only by the tip of an ISA triangle", () => {
      const isA: Shape = {
        id: "isA",
        polygon: outlinePolygon(
          { type: "isA", width: 96, height: 64 },
          { x: 48, y: 32 },
        ),
        occludesEdges: true,
        containerIds: [],
      };

      expect(
        findOcclusions([isA, box("under", 40, 66, 40, 40)], []),
      ).toHaveLength(1);
      // 6px lower and the triangle has ended
      expect(findOcclusions([isA, box("clear", 40, 72, 40, 40)], [])).toEqual(
        [],
      );
    });

    it("does not call touching an overlap", () => {
      expect(findOcclusions([box("a", 0, 0), box("b", 100, 0)], [])).toEqual(
        [],
      );
    });

    it("ignores an overlap too shallow to see, and reports one that is not", () => {
      expect(findOcclusions([box("a", 0, 0), box("b", 99.6, 0)], [])).toEqual(
        [],
      );
      expect(
        findOcclusions([box("a", 0, 0), box("b", 99.3, 0)], []),
      ).toHaveLength(1);
    });

    it("reports a shape sitting entirely inside another", () => {
      expect(
        findOcclusions([box("big", 0, 0, 300, 300), box("small", 50, 50)], []),
      ).toHaveLength(1);
    });
  });

  describe("aggregations", () => {
    const container = (id: string, x: number, y: number): Shape =>
      box(id, x, y, 500, 500, { occludesEdges: false });

    const member = (id: string, x: number, y: number, inside: string): Shape =>
      box(id, x, y, 100, 100, { containerIds: [inside] });

    it("lets a container hold its members", () => {
      expect(
        findOcclusions(
          [container("agg", 0, 0), member("m", 50, 50, "agg")],
          [],
        ),
      ).toEqual([]);
    });

    it("holds a member of a nested container too", () => {
      const inner = box("inner", 20, 20, 300, 300, {
        occludesEdges: false,
        containerIds: ["outer"],
      });
      const deep = box("deep", 40, 40, 50, 50, {
        containerIds: ["inner", "outer"],
      });

      expect(
        findOcclusions([container("outer", 0, 0), inner, deep], []),
      ).toEqual([]);
    });

    /** It reads as aggregated when it is not, which is the worse misreading. */
    it("reports a stranger sitting inside a container", () => {
      const marks = findOcclusions(
        [container("agg", 0, 0), box("stranger", 450, 450)],
        [],
      );

      expect(marks).toHaveLength(1);
      expect(marks[0].id).toBe("shape:agg|stranger");
    });

    it("reports two containers overlapping each other", () => {
      expect(
        findOcclusions([container("one", 0, 0), container("two", 400, 0)], []),
      ).toHaveLength(1);
    });

    /**
     * A line drawn to an aggregation stops on the container's outline, so it
     * never reaches what is inside. Without this every element in a box looks
     * like it swallows every edge arriving at the box.
     */
    it("lets a member sit under a line drawn to its own container", () => {
      const marks = findOcclusions(
        [
          container("agg", 0, 0),
          member("m", 200, 200, "agg"),
          box("far", 900, 200),
        ],
        [route("e", "far", "agg", { x: 950, y: 250 }, { x: 250, y: 250 })],
      );

      expect(marks).toEqual([]);
    });

    /** Translucent, and it covers every edge between its own members by design. */
    it("lets a line run under a container", () => {
      const marks = findOcclusions(
        [container("agg", 0, 0), box("far", 900, 0)],
        [
          route(
            "e",
            "far",
            "elsewhere",
            { x: 900, y: 250 },
            { x: -100, y: 250 },
          ),
        ],
      );

      expect(marks).toEqual([]);
    });
  });

  describe("edges under shapes", () => {
    const between = (...shapes: Shape[]) => shapes;

    it("reports the run of line a shape swallows", () => {
      const marks = findOcclusions(
        between(box("from", -200, 0), box("through", 0, 0), box("to", 200, 0)),
        [route("e", "from", "to", { x: -150, y: 50 }, { x: 250, y: 50 })],
      );

      expect(marks).toHaveLength(1);
      const mark = marks[0];
      expect(mark.kind).toBe("edge");
      if (mark.kind !== "edge") throw new Error("expected an edge mark");
      expect(mark.shapeId).toBe("through");
      expect(mark.spans).toEqual([
        [
          { x: 0, y: 50 },
          { x: 100, y: 50 },
        ],
      ]);
    });

    it("says nothing about the shapes the line is drawn to", () => {
      expect(
        findOcclusions(between(box("from", 0, 0), box("to", 300, 0)), [
          route("e", "from", "to", { x: 50, y: 50 }, { x: 350, y: 50 }),
        ]),
      ).toEqual([]);
    });

    it("ignores a line that only just clips a shape", () => {
      const graze = (reach: number) =>
        findOcclusions(between(box("shape", 0, 0), box("far", 400, 0)), [
          route(
            "e",
            "far",
            "elsewhere",
            { x: -10, y: 50 },
            { x: reach, y: 50 },
          ),
        ]);

      expect(graze(2)).toEqual([]);
      expect(graze(6)).toHaveLength(1);
    });

    /** An orthogonal route can leave a shape and come back into it. */
    it("collects every run when the route re-enters", () => {
      const marks = findOcclusions(
        between(box("shape", 0, 0), box("far", 400, 400)),
        [
          route(
            "e",
            "far",
            "elsewhere",
            { x: -20, y: 20 },
            { x: 120, y: 20 },
            { x: 120, y: 80 },
            { x: -20, y: 80 },
          ),
        ],
      );

      expect(marks).toHaveLength(1);
      const mark = marks[0];
      if (mark.kind !== "edge") throw new Error("expected an edge mark");
      expect(mark.spans).toHaveLength(2);
    });

    /**
     * One defect, one mark. Once two shapes are known to overlap, every edge
     * arriving at one of them runs into the other as well -- reporting those
     * would turn a single problem into a mark per edge.
     */
    it("does not re-report an overlap once per edge into it", () => {
      const marks = findOcclusions(
        between(
          box("a", 0, 0),
          box("c", 60, 0),
          box("far", 400, 0),
          box("other", 400, 200),
        ),
        [
          route("e1", "far", "a", { x: 450, y: 50 }, { x: 50, y: 50 }),
          route("e2", "other", "a", { x: 450, y: 250 }, { x: 50, y: 50 }),
        ],
      );

      expect(marks).toHaveLength(1);
      expect(marks[0].kind).toBe("shape");
    });

    it("ignores a route with nothing to draw", () => {
      expect(
        findOcclusions(between(box("shape", 0, 0)), [
          route("e", "from", "to", { x: 50, y: 50 }),
        ]),
      ).toEqual([]);
    });
  });
});

describe("crowded diagrams", () => {
  /**
   * A diagram nobody has arranged yet overlaps everywhere, and the honest
   * answer there is "all of it" rather than a mark per pair -- which would bury
   * the drawing and spend the frame looking for the rest.
   */
  it("stops counting once the diagram is a pile", () => {
    const pile = Array.from({ length: 40 }, (_, i) =>
      box(`n${i}`, i * 2, i * 2, 200, 200),
    );

    const marks = findOcclusions(pile, []);

    expect(marks).toHaveLength(MAX_OCCLUSIONS);
  });

  it("reports the real count while it is still worth reading", () => {
    const few = [box("a", 0, 0), box("b", 60, 0), box("c", 400, 0)];

    expect(findOcclusions(few, []).length).toBeLessThan(MAX_OCCLUSIONS);
  });
});

describe("signedArea", () => {
  it("is positive for the winding every outline uses", () => {
    expect(signedArea(boxPolygon(0, 0, 100, 100))).toBeGreaterThan(0);
    expect(signedArea(diamond("d", 0, 0, 50).polygon)).toBeGreaterThan(0);
  });
});
