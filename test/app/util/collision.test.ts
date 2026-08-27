import {
  PositionedNode,
  Rect,
} from "../../../src/app/util/alignmentCandidates";
import {
  obstaclesFor,
  relatedIds,
  slideOutOfCollisions,
  visualRects,
} from "../../../src/app/util/collision";

const rect = (
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 100,
): Rect => ({ id, x, y, width, height });

const node = (
  id: string,
  x: number,
  y: number,
  extra: Partial<PositionedNode> = {},
): PositionedNode => ({
  id,
  type: "entity",
  position: { x, y },
  width: 100,
  height: 100,
  ...extra,
});

describe("relatedIds", () => {
  const diagram = [
    node("box", 0, 0, { type: "aggregation", width: 500, height: 500 }),
    node("member", 40, 40, { parentNode: "box" }),
    node("attr", 10, 10, { type: "entity-attribute", parentNode: "member" }),
    node("outside", 900, 900),
  ];

  it("frees a node from whatever contains it", () => {
    expect([...relatedIds(diagram, "member")].sort()).toEqual([
      "attr",
      "box",
      "member",
    ]);
  });

  it("frees a container from everything it holds", () => {
    expect([...relatedIds(diagram, "box")].sort()).toEqual([
      "attr",
      "box",
      "member",
    ]);
  });

  it("leaves an unrelated node on its own", () => {
    expect([...relatedIds(diagram, "outside")]).toEqual(["outside"]);
  });
});

describe("obstaclesFor", () => {
  const diagram = [
    node("box", 0, 0, { type: "aggregation", width: 500, height: 500 }),
    node("member", 40, 40, { parentNode: "box" }),
    node("outside", 900, 900),
  ];

  it("excludes the node's own family and itself", () => {
    expect(obstaclesFor(diagram, "member").map((r) => r.id)).toEqual([
      "outside",
    ]);
  });

  it("resolves a member's rectangle into absolute coordinates", () => {
    const [box] = obstaclesFor(diagram, "outside").filter(
      (r) => r.id === "member",
    );
    expect(box).toMatchObject({ x: 40, y: 40 });
  });
});

describe("visualRects", () => {
  // a diamond is a square rotated inside its box, so it reaches past it
  it("grows a relationship to what it covers", () => {
    const [r] = visualRects([
      node("d", 0, 0, { type: "relationship", width: 95, height: 95 }),
    ]);
    expect(r.width).toBeCloseTo((95 + 95) / Math.SQRT2, 6);
    expect(r.x).toBeCloseTo(47.5 - r.width / 2, 6);
  });

  it("leaves an entity at its own box", () => {
    expect(visualRects([node("e", 10, 20)])).toEqual([rect("e", 10, 20)]);
  });
});

describe("slideOutOfCollisions", () => {
  const wall = rect("wall", 300, 0, 100, 400);

  it("leaves a shape alone when it hits nothing", () => {
    const moved = rect("a", 0, 0);
    expect(slideOutOfCollisions(moved, { x: -10, y: 0 }, [wall])).toEqual({
      x: 0,
      y: 0,
    });
  });

  it("stops a shape at the side it ran into", () => {
    // came from the left, ended up 40px inside the wall
    const moved = rect("a", 240, 100);
    expect(slideOutOfCollisions(moved, { x: 150, y: 100 }, [wall])).toEqual({
      x: 200,
      y: 100,
    });
  });

  it("stops it on the other side when it comes the other way", () => {
    const moved = rect("a", 360, 100);
    expect(slideOutOfCollisions(moved, { x: 500, y: 100 }, [wall])).toEqual({
      x: 400,
      y: 100,
    });
  });

  /** The point of resolving one axis at a time: blocked across, free along. */
  it("still slides along the obstacle it is pressed against", () => {
    const moved = rect("a", 240, 180);
    expect(slideOutOfCollisions(moved, { x: 200, y: 100 }, [wall])).toEqual({
      x: 200,
      y: 180,
    });
  });

  it("lets a shape leave an obstacle it already overlapped", () => {
    // laid out on top of the wall to begin with: it must not be trapped
    const moved = rect("a", 320, 100);
    expect(slideOutOfCollisions(moved, { x: 310, y: 100 }, [wall])).toEqual({
      x: 320,
      y: 100,
    });
  });

  it("touching is not overlapping", () => {
    const moved = rect("a", 200, 100);
    expect(slideOutOfCollisions(moved, { x: 100, y: 100 }, [wall])).toEqual({
      x: 200,
      y: 100,
    });
  });

  it("keeps out of several shapes at once", () => {
    const above = rect("above", 0, 0, 400, 100);
    const moved = rect("a", 240, 40);
    const free = slideOutOfCollisions(moved, { x: 150, y: 150 }, [wall, above]);
    for (const obstacle of [wall, above]) {
      const overlaps =
        free.x < obstacle.x + obstacle.width &&
        obstacle.x < free.x + moved.width &&
        free.y < obstacle.y + obstacle.height &&
        obstacle.y < free.y + moved.height;
      expect(overlaps).toBe(false);
    }
  });

  it("stops against a slot it is too wide to enter", () => {
    const left = rect("left", 0, 0, 100, 400);
    const right = rect("right", 150, 0, 100, 400);
    // a 100-wide shape cannot fit in the 50px gap between them, so coming down
    // from above it comes to rest on top of both rather than wedging in
    const moved = rect("a", 110, 100);
    expect(
      slideOutOfCollisions(moved, { x: 110, y: -200 }, [left, right]),
    ).toEqual({ x: 110, y: -100 });
  });

  /**
   * The guarantee the whole thing exists for, swept over a grid of approaches
   * rather than a handful of hand-picked ones.
   */
  it("never leaves the shape overlapping anything that could block it", () => {
    const obstacles = [
      rect("a", 300, 0, 100, 400),
      rect("b", 0, 300, 400, 100),
      rect("c", 520, 260, 60, 60),
    ];
    const overlaps = (p: { x: number; y: number }, o: Rect) =>
      p.x < o.x + o.width &&
      o.x < p.x + 100 &&
      p.y < o.y + o.height &&
      o.y < p.y + 100;

    for (let x = -150; x <= 650; x += 25)
      for (let y = -150; y <= 500; y += 25) {
        const from = { x: x - 25, y: y - 25 };
        const moved = rect("m", x, y);
        const blocking = obstacles.filter((o) => !overlaps(from, o));
        const free = slideOutOfCollisions(moved, from, obstacles);
        for (const obstacle of blocking)
          expect({
            from,
            to: free,
            obstacle: obstacle.id,
            hit: overlaps(free, obstacle),
          }).toMatchObject({ hit: false });
      }
  });
});
