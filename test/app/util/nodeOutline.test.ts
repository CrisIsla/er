import { visualRectOf } from "../../../src/app/util/layout/geometry";
import {
  capBurial,
  outlineDistance,
  outlineExit,
  outlineHit,
  outlinePolygon,
  polygonBounds,
} from "../../../src/app/util/nodeOutline";

const RIGHT = 0;
const DOWN = Math.PI / 2;
const LEFT = Math.PI;
const UP = -Math.PI / 2;
const DOWN_RIGHT = Math.PI / 4;

describe("outlineDistance", () => {
  it("reaches the sides of an entity box", () => {
    const entity = { type: "entity", width: 200, height: 40 };

    expect(outlineDistance(entity, RIGHT)).toBeCloseTo(100);
    expect(outlineDistance(entity, LEFT)).toBeCloseTo(100);
    expect(outlineDistance(entity, DOWN)).toBeCloseTo(20);
    expect(outlineDistance(entity, UP)).toBeCloseTo(20);
  });

  it("leaves a flat entity through the bottom on a diagonal", () => {
    // 45 degrees on a 200x40 box crosses the bottom edge, 20px below the
    // centre, not the right edge 100px away
    const distance = outlineDistance(
      { type: "entity", width: 200, height: 40 },
      DOWN_RIGHT,
    );

    expect(distance).toBeCloseTo(20 * Math.SQRT2);
  });

  it("follows the ellipse of an attribute", () => {
    const attribute = { type: "entity-attribute", width: 120, height: 40 };

    expect(outlineDistance(attribute, RIGHT)).toBeCloseTo(60);
    expect(outlineDistance(attribute, DOWN)).toBeCloseTo(20);
    // on the diagonal the ellipse is closer than the box corner
    expect(outlineDistance(attribute, DOWN_RIGHT)).toBeLessThan(
      Math.hypot(60, 20),
    );
    expect(outlineDistance(attribute, DOWN_RIGHT)).toBeCloseTo(
      1 / Math.hypot(Math.SQRT1_2 / 60, Math.SQRT1_2 / 20),
    );
  });

  it("reaches the vertices of a rotated relationship diamond", () => {
    // 95x95 measured, so the diamond covers its ~134px diagonal
    const relationship = { type: "relationship", width: 95, height: 95 };
    const halfDiagonal = (95 * Math.SQRT2) / 2;

    expect(outlineDistance(relationship, RIGHT)).toBeCloseTo(halfDiagonal);
    expect(outlineDistance(relationship, DOWN)).toBeCloseTo(halfDiagonal);
    // towards a corner of the box it is the side of the square, half way
    // between two vertices
    expect(outlineDistance(relationship, DOWN_RIGHT)).toBeCloseTo(95 / 2);
  });

  it("stops on the edges of an ISA triangle", () => {
    const isA = { type: "isA", width: 96, height: 64 };

    // the top edge runs along the top of the box
    expect(outlineDistance(isA, UP)).toBeCloseTo(32);
    // the apex hangs below it
    expect(outlineDistance(isA, DOWN)).toBeCloseTo(38);
    // the slanted sides are much closer than the box's own sides
    expect(outlineDistance(isA, RIGHT)).toBeLessThan(48);
    expect(outlineDistance(isA, RIGHT)).toBeCloseTo(
      outlineDistance(isA, LEFT),
      5,
    );
  });

  it("gives nothing for a node that has not been measured", () => {
    expect(outlineDistance({ type: "entity" }, RIGHT)).toBe(0);
    expect(
      outlineDistance({ type: "entity", width: 0, height: 0 }, RIGHT),
    ).toBe(0);
  });

  it("treats an unknown node type as its box", () => {
    expect(
      outlineDistance({ type: "aggregation", width: 500, height: 300 }, RIGHT),
    ).toBeCloseTo(250);
    expect(outlineDistance({ width: 500, height: 300 }, DOWN)).toBeCloseTo(150);
  });
});

describe("outlineHit", () => {
  it("reports which way each side of an entity faces", () => {
    const entity = { type: "entity", width: 200, height: 40 };

    expect(outlineHit(entity, RIGHT).normal).toBeCloseTo(RIGHT);
    expect(outlineHit(entity, DOWN).normal).toBeCloseTo(DOWN);
    expect(outlineHit(entity, UP).normal).toBeCloseTo(UP);
    expect(Math.abs(outlineHit(entity, LEFT).normal)).toBeCloseTo(Math.PI);
  });

  it("reports the slanted faces of a relationship diamond", () => {
    // a ray to the right leaves through the vertex where the two right-hand
    // faces meet; whichever is reported, it is slanted at 45 degrees
    const facing = outlineHit(
      { type: "relationship", width: 95, height: 95 },
      DOWN_RIGHT,
    ).normal;

    expect(facing).toBeCloseTo(DOWN_RIGHT);
  });

  it("follows the curve of an attribute ellipse", () => {
    // on a wide ellipse the outline faces further from the ray than on a circle
    const facing = outlineHit(
      { type: "entity-attribute", width: 120, height: 40 },
      DOWN_RIGHT,
    ).normal;

    expect(facing).toBeGreaterThan(DOWN_RIGHT);
    expect(facing).toBeLessThan(DOWN);
  });
});

/**
 * Rays that start off the centre of the box, which is what several lines between
 * the same pair of shapes need: each is moved across the line it would have
 * drawn, rather than turned, so they stay parallel and each still leaves its own
 * shape.
 */
describe("outlineExit", () => {
  /**
   * The ellipse is solved two ways -- a closed form from the centre, the root of
   * a quadratic from anywhere else -- and only one of them is exercised by the
   * rest of the diagram, since an attribute is only ever aimed at from its
   * centre. Starting part of the way along the same ray is the case where the
   * two have to agree.
   */
  it("solves an ellipse the same way wherever the ray starts", () => {
    const attribute = { type: "entity-attribute", width: 120, height: 40 };

    expect(outlineHit(attribute, RIGHT).distance).toBeCloseTo(60);
    for (const start of [1e-9, 15, 30, 59])
      expect(
        outlineExit(attribute, { x: start, y: 0 }, RIGHT).distance + start,
      ).toBeCloseTo(60);
  });

  it("leaves a box through the same side, shorter by the head start", () => {
    const entity = { type: "entity", width: 200, height: 40 };

    // 30px along the way out, so 70 of the 100 are left
    expect(outlineExit(entity, { x: 30, y: 0 }, RIGHT).distance).toBeCloseTo(
      70,
    );
    expect(outlineExit(entity, { x: 30, y: 0 }, RIGHT).normal).toBeCloseTo(
      RIGHT,
    );
    // 15px across it changes nothing about how far there is to go
    expect(outlineExit(entity, { x: 0, y: 15 }, RIGHT).distance).toBeCloseTo(
      100,
    );
  });

  it("leaves an ellipse where the ray actually crosses it", () => {
    const attribute = { type: "entity-attribute", width: 120, height: 40 };

    // a ray starting on the minor axis and running along the major one meets
    // the ellipse where x = a * sqrt(1 - (y/b)^2)
    const reach = outlineExit(attribute, { x: 0, y: 10 }, RIGHT).distance;
    expect(reach).toBeCloseTo(60 * Math.sqrt(1 - (10 / 20) ** 2));

    // and the point it found is on the curve
    const point = { x: reach, y: 10 };
    expect((point.x / 60) ** 2 + (point.y / 20) ** 2).toBeCloseTo(1);
  });

  it("reports no hit for a node nothing has measured", () => {
    expect(outlineExit({ type: "entity" }, { x: 5, y: 5 }, RIGHT)).toEqual({
      distance: 0,
      normal: RIGHT,
    });
  });
});

describe("capBurial", () => {
  it("asks for nothing when the line arrives head on", () => {
    expect(capBurial(5, RIGHT, RIGHT)).toBeCloseTo(0);
    expect(capBurial(5, DOWN, DOWN)).toBeCloseTo(0);
  });

  it("asks for half the width at 45 degrees", () => {
    expect(capBurial(5, DOWN_RIGHT, RIGHT)).toBeCloseTo(2.5);
  });

  it("grows as the line flattens against the shape", () => {
    const shallow = capBurial(5, RIGHT + 1.2, RIGHT);
    const steep = capBurial(5, RIGHT + 0.3, RIGHT);

    expect(shallow).toBeGreaterThan(steep);
    // but never runs away: a line grazing the surface is capped
    expect(capBurial(5, RIGHT + Math.PI / 2, RIGHT)).toBe(15);
  });

  it("scales with the width of the stroke", () => {
    expect(capBurial(1, DOWN_RIGHT, RIGHT)).toBeCloseTo(0.5);
  });
});

describe("outlinePolygon", () => {
  const CENTRE = { x: 0, y: 0 };

  /**
   * The clips in util/occlusion.ts read the inside of a shape off the sign of
   * this, so a reversed constant would not throw -- it would quietly report
   * that nothing ever overlaps. Every outline has to wind the same way.
   */
  const shoelace = (polygon: { x: number; y: number }[]) =>
    polygon.reduce((total, from, index) => {
      const to = polygon[(index + 1) % polygon.length];
      return total + (from.x * to.y - to.x * from.y);
    }, 0);

  it("winds every shape the same way", () => {
    const shapes = [
      { type: "entity", width: 200, height: 40 },
      { type: "relationship", width: 95, height: 95 },
      { type: "isA", width: 96, height: 64 },
      { type: "entity-attribute", width: 200, height: 44 },
    ];

    for (const shape of shapes)
      expect(shoelace(outlinePolygon(shape, CENTRE))).toBeGreaterThan(0);
  });

  it("has nothing to draw for an unmeasured node", () => {
    expect(outlinePolygon({ type: "entity" }, CENTRE)).toEqual([]);
  });

  it("inscribes an attribute's ellipse rather than enclosing it", () => {
    const ellipse = outlinePolygon(
      { type: "entity-attribute", width: 200, height: 44 },
      CENTRE,
    );

    // the sample points land on the ellipse, so every one of them is within it
    for (const point of ellipse)
      expect((point.x / 100) ** 2 + (point.y / 22) ** 2).toBeCloseTo(1, 6);
  });
});

describe("polygonBounds", () => {
  const boundsOfNode = (type: string, width: number, height: number) =>
    polygonBounds(
      outlinePolygon({ type, width, height }, { x: width / 2, y: height / 2 }),
    );

  /**
   * The two encodings of "what this shape covers" have to agree wherever
   * visualSize has an answer, or the prefilter would discard pairs the polygon
   * clip would have found.
   */
  it("agrees with visualRectOf for the shapes that fill their box", () => {
    for (const [type, width, height] of [
      ["entity", 200, 40],
      ["relationship", 95, 95],
      ["entity-attribute", 200, 44],
    ] as const) {
      const visual = visualRectOf(type, type, { x: 0, y: 0 }, width, height);
      const bounds = boundsOfNode(type, width, height);

      expect(bounds.x).toBeCloseTo(visual.x, 6);
      expect(bounds.y).toBeCloseTo(visual.y, 6);
      expect(bounds.width).toBeCloseTo(visual.width, 6);
      expect(bounds.height).toBeCloseTo(visual.height, 6);
    }
  });

  /**
   * The ISA triangle is the one shape visualSize does not correct. Its apex
   * hangs below the node box, so a rectangle taken from the box misses an
   * overlap there entirely -- and would clip the mark drawn for one.
   */
  it("reaches past the box for an ISA triangle, where visualRectOf cannot", () => {
    const visual = visualRectOf("isA", "isA", { x: 0, y: 0 }, 96, 64);
    const bounds = boundsOfNode("isA", 96, 64);

    expect(bounds.height).toBeCloseTo(70, 6);
    expect(bounds.height).toBeGreaterThan(visual.height);
    expect(bounds.y + bounds.height).toBeCloseTo(70, 6);
    // and it is narrower than the box, which is the other half of the saving
    expect(bounds.width).toBeCloseTo(80, 6);
  });
});
