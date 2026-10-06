import { Node } from "reactflow";
import {
  aimedEnd,
  handleSlot,
} from "../../../src/app/components/ErDiagram/notations/useEdgePath";

const shape = (type: string, width: number, height: number) =>
  ({ type, width, height }) as Node;

const CONTAINER = shape("aggregation", 348, 547);
const DIAMOND = shape("relationship", 95, 95);
const ENTITY = shape("entity", 158, 44);

/** How far this end reached out from its own centre. */
const reachOf = (
  a: Node,
  b: Node,
  centerA: { x: number; y: number },
  centerB: { x: number; y: number },
) => {
  const [x, y] = aimedEnd(a, b, centerA, centerB);
  return Math.hypot(x - centerA.x, y - centerA.y);
};

describe("aimedEnd", () => {
  /**
   * The bug this pins: sharing the distance evenly stops the line a long way
   * inside a container, because the container's half-width is bigger than half
   * the distance to the small shape it joins.
   */
  it("reaches a big container's own outline, not half way", () => {
    const container = { x: 623.4, y: 323.5 };
    const diamond = { x: 323.5, y: 323.5 };
    expect(reachOf(CONTAINER, DIAMOND, container, diamond)).toBeCloseTo(174, 6);
  });

  it("lands on the border, wherever the other shape is", () => {
    const container = { x: 0, y: 0 };
    for (const other of [
      { x: -400, y: 0 },
      { x: 0, y: -520 },
      { x: 380, y: 300 },
      { x: -390, y: 420 },
    ]) {
      const [x, y] = aimedEnd(CONTAINER, DIAMOND, container, other);
      const onBorder =
        Math.abs(Math.abs(x) - 174) < 1e-6 ||
        Math.abs(Math.abs(y) - 273.5) < 1e-6;
      expect(onBorder).toBe(true);
      expect(Math.abs(x)).toBeLessThanOrEqual(174 + 1e-6);
      expect(Math.abs(y)).toBeLessThanOrEqual(273.5 + 1e-6);
    }
  });

  it("gives both ends their full outline while the shapes are clear", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 400, y: 0 };
    expect(reachOf(CONTAINER, DIAMOND, a, b)).toBeCloseTo(174, 6);
    expect(reachOf(DIAMOND, CONTAINER, b, a)).toBeCloseTo(
      (95 * Math.SQRT2) / 2,
      6,
    );
  });

  /** Overlapping shapes share what there is, so the line cannot double back. */
  it("meets at a single point when the shapes overlap", () => {
    const a = { x: 0, y: 0 };
    const b = { x: 200, y: 0 };
    const gap = 200;
    const reachA = reachOf(CONTAINER, DIAMOND, a, b);
    const reachB = reachOf(DIAMOND, CONTAINER, b, a);
    expect(reachA + reachB).toBeCloseTo(gap, 6);
    expect(reachA).toBeLessThan(174);
  });

  it("stays finite for a node nothing has measured", () => {
    const bare = { type: "entity" } as Node;
    const [x, y] = aimedEnd(bare, DIAMOND, { x: 0, y: 0 }, { x: 100, y: 100 });
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });

  /**
   * Both ends of one role edge, called the way getErEdgeParams calls them: the
   * diamond is the source of a role edge (childParticipantToEdge in
   * util/erToReactflowElements.ts), and the entity end is given the slot
   * negated.
   */
  const roleEnds = (
    slot: number,
    diamond: { x: number; y: number },
    entity: { x: number; y: number },
  ) =>
    [
      aimedEnd(DIAMOND, ENTITY, diamond, entity, slot),
      aimedEnd(ENTITY, DIAMOND, entity, diamond, -slot),
    ] as const;

  /**
   * The bug this pins: an entity can fill more than one role in the same
   * relationship, and aiming at the centre is a question about the two centres
   * alone -- so every one of those edges came out as the same line drawn again,
   * one label painted over the other.
   *
   * This is the answer for an orthogonal route, which cannot bow: move the ends
   * apart instead, to where the `side` anchor's handles would have been. A
   * straight route leaves the ends alone and bows (roleBow), so it is the route
   * tests that cover that one.
   */
  it("gives each role of one relationship its own point", () => {
    const entity = { x: 0, y: 0 };
    const diamond = { x: 400, y: 0 };

    const [, [firstX, firstY]] = roleEnds(-2, diamond, entity);
    const [, [lastX, lastY]] = roleEnds(2, diamond, entity);

    // the entity's own half-height is the smaller room across the line, so the
    // pair lands where its outermost handles sit: 2% and 98% of a 44px side,
    // and in that order -- `1` at the top of the side, `4` at the bottom
    expect(firstX).toBeCloseTo(79, 6);
    expect(lastX).toBeCloseTo(79, 6);
    expect(firstY).toBeCloseTo(-21.12, 6);
    expect(lastY).toBeCloseTo(21.12, 6);
  });

  it("leaves an edge with no role exactly where it was", () => {
    const entity = { x: 0, y: 0 };
    for (const other of [
      { x: 400, y: 0 },
      { x: 0, y: -520 },
      { x: 380, y: 300 },
      { x: -390, y: 420 },
    ])
      expect(aimedEnd(ENTITY, DIAMOND, entity, other, 0)).toEqual(
        aimedEnd(ENTITY, DIAMOND, entity, other),
      );
  });

  /**
   * The far end is called with the bearing reversed *and* the slot negated. Drop
   * either and the line pivots about its middle instead of moving across, so two
   * roles cross in an X with both lines through the same midpoint.
   */
  it("moves both ends of one role the same way across the line", () => {
    const entity = { x: 0, y: 0 };
    const diamond = { x: 300, y: 200 };

    const [[bx, by], [ax, ay]] = roleEnds(2, diamond, entity);

    // the component of each end across the centre-to-centre line
    const angle = Math.atan2(200, 300);
    const acrossOf = (x: number, y: number, cx: number, cy: number) =>
      -(x - cx) * Math.sin(angle) + (y - cy) * Math.cos(angle);

    const atEntity = acrossOf(ax, ay, entity.x, entity.y);
    const atDiamond = acrossOf(bx, by, diamond.x, diamond.y);

    expect(Math.sign(atEntity)).toBe(Math.sign(atDiamond));
    expect(atEntity).toBeCloseTo(atDiamond, 6);
  });

  /**
   * Moving the line across keeps it parallel to the ray each end leaves along,
   * so it still leaves the shape. Turning the ray instead does not: the line
   * between two turned rays runs along neither of them, and on a wide entity it
   * comes back through the fill for twenty-odd pixels before it gets out.
   */
  it("keeps a role's line clear of the shape it leaves", () => {
    const [[bx, by], [ax, ay, facing]] = roleEnds(
      2,
      { x: 52.6, y: -172.1 },
      { x: 0, y: 0 },
    );

    const line = Math.atan2(by - ay, bx - ax);
    expect(Math.cos(line - facing)).toBeGreaterThan(0);
  });

  it("still meets at a single point when the shapes overlap", () => {
    const [[bx, by], [ax, ay]] = roleEnds(2, { x: 100, y: 0 }, { x: 0, y: 0 });

    expect(ax).toBeCloseTo(bx, 6);
    expect(ay).toBeCloseTo(by, 6);
  });

  it("stays finite for an unmeasured node with a role", () => {
    const bare = { type: "entity" } as Node;
    const [x, y] = aimedEnd(
      bare,
      DIAMOND,
      { x: 0, y: 0 },
      { x: 100, y: 100 },
      2,
    );
    expect(Number.isFinite(x)).toBe(true);
    expect(Number.isFinite(y)).toBe(true);
  });
});

/**
 * The order the shapes lay their handles out in, which the slots mirror so that
 * the roles keep the order they have under the `side` anchor: `1` at one end of
 * the side, `4` at the other, the unnumbered handle in the middle.
 */
describe("handleSlot", () => {
  it("reads the five handles as positions across the line", () => {
    expect(["1", "2", "", "3", "4"].map(handleSlot)).toEqual([-2, -1, 0, 1, 2]);
  });

  it("puts anything it does not recognise in the middle", () => {
    expect(handleSlot("t")).toBe(0);
    expect(handleSlot("9")).toBe(0);
  });
});
