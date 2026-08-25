import {
  capBurial,
  outlineDistance,
  outlineHit,
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
