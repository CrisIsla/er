import { Node } from "reactflow";
import { aimedEnd } from "../../../src/app/components/ErDiagram/notations/useEdgePath";

const shape = (type: string, width: number, height: number) =>
  ({ type, width, height }) as Node;

const CONTAINER = shape("aggregation", 348, 547);
const DIAMOND = shape("relationship", 95, 95);

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
});
