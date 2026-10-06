import { Node, Position, internalsSymbol } from "reactflow";
import {
  drawnRoute,
  routePoints,
} from "../../../src/app/components/ErDiagram/notations/useEdgePath";

const LEFT_TO_RIGHT = { from: { x: 0, y: 0 }, to: { x: 200, y: 100 } };

/** A node with one handle a side, the way React Flow measures an attribute. */
const node = (x: number, y: number, width = 100, height = 40): Node =>
  ({
    id: `${x},${y}`,
    type: "entity",
    position: { x, y },
    positionAbsolute: { x, y },
    width,
    height,
    [internalsSymbol]: {
      handleBounds: {
        source: [
          {
            id: "t",
            position: Position.Top,
            x: width / 2,
            y: 0,
            width: 0,
            height: 0,
          },
          {
            id: "b",
            position: Position.Bottom,
            x: width / 2,
            y: height,
            width: 0,
            height: 0,
          },
          {
            id: "l",
            position: Position.Left,
            x: 0,
            y: height / 2,
            width: 0,
            height: 0,
          },
          {
            id: "r",
            position: Position.Right,
            x: width,
            y: height / 2,
            width: 0,
            height: 0,
          },
        ],
        target: [],
      },
    },
  }) as unknown as Node;

/** The same, shaped as a relationship: a square the diagram draws rotated. */
const diamond = (x: number, y: number): Node =>
  ({ ...node(x, y, 40, 40), type: "relationship" }) as unknown as Node;

describe("routePoints", () => {
  it("gives a straight edge its two ends and nothing else", () => {
    expect(
      routePoints(
        false,
        LEFT_TO_RIGHT.from,
        LEFT_TO_RIGHT.to,
        Position.Right,
        Position.Left,
      ),
    ).toEqual([LEFT_TO_RIGHT.from, LEFT_TO_RIGHT.to]);
  });

  /**
   * The route is read back out of the path React Flow draws, so this is really
   * asking whether the parser survives what `getSmoothStepPath` emits. It bends
   * with a radius of zero, which still produces a curve command at every
   * corner -- one landing exactly where the line into it already was.
   */
  it("follows an orthogonal route corner by corner", () => {
    const points = routePoints(
      true,
      LEFT_TO_RIGHT.from,
      LEFT_TO_RIGHT.to,
      Position.Right,
      Position.Left,
    );

    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual(LEFT_TO_RIGHT.from);
    expect(points[points.length - 1]).toEqual(LEFT_TO_RIGHT.to);

    // every leg is horizontal or vertical, which is what makes it orthogonal
    for (const [index, point] of points.slice(1).entries()) {
      const previous = points[index];
      expect(point.x === previous.x || point.y === previous.y).toBe(true);
    }
  });

  it("does not repeat a corner it arrives at twice", () => {
    const points = routePoints(
      true,
      LEFT_TO_RIGHT.from,
      LEFT_TO_RIGHT.to,
      Position.Right,
      Position.Left,
    );

    for (const [index, point] of points.slice(1).entries())
      expect(point).not.toEqual(points[index]);
  });
});

describe("drawnRoute", () => {
  it("runs between the handles the two shapes face each other with", () => {
    const points = drawnRoute(node(0, 0), node(400, 0), "", "side", false);

    expect(points).toHaveLength(2);
    // the right handle of the first, the left handle of the second
    expect(points[0]).toEqual({ x: 100, y: 20 });
    expect(points[1]).toEqual({ x: 400, y: 20 });
  });

  /**
   * `getHandleCoordsByPosition` answers a handle it cannot find with the flow
   * origin. A line from there would cross the whole diagram and appear to be
   * swallowed by everything in the way.
   */
  it("reports nothing rather than a line from the flow origin", () => {
    const withoutHandles = {
      ...node(400, 0),
      [internalsSymbol]: { handleBounds: { source: [], target: [] } },
    } as unknown as Node;

    expect(drawnRoute(node(0, 0), withoutHandles, "", "side", false)).toEqual(
      [],
    );
  });

  it("reports nothing for a node React Flow has not placed yet", () => {
    const unplaced = { ...node(0, 0), positionAbsolute: undefined } as Node;

    expect(drawnRoute(unplaced, node(400, 0), "", "side", false)).toEqual([]);
  });

  /**
   * The bug this pins, at the level it was seen: with the endpoints aimed at
   * the shapes' centres, the two role edges of one relationship were the same
   * line drawn twice. The occlusion pass reads its routes from here, so it was
   * seeing the same doubled line the reader was.
   *
   * Aiming at a centre never looks a handle up, which is why these need no
   * numbered handles in the fixture.
   */
  it("bows the two roles of one relationship apart", () => {
    const relationship = diamond(400, 0);
    const entity = node(0, 0);
    const middleOf = (route: { x: number; y: number }[]) =>
      route[Math.floor(route.length / 2)];

    const first = drawnRoute(relationship, entity, "1", "centre", false);
    const last = drawnRoute(relationship, entity, "4", "centre", false);

    // both centres sit at y = 20; the roles leave it to either side
    expect(middleOf(first).y).toBeLessThan(10);
    expect(middleOf(last).y).toBeGreaterThan(30);
  });

  /**
   * What bowing buys over moving the ends apart: a role still arrives exactly
   * where the one line it is a part of would have. Only the way there differs.
   */
  it("leaves a bowed role where a plain line would meet the shape", () => {
    const relationship = diamond(400, 0);
    const entity = node(0, 0);

    const plain = drawnRoute(relationship, entity, "", "centre", false);
    for (const prefix of ["1", "2", "3", "4"]) {
      const role = drawnRoute(relationship, entity, prefix, "centre", false);
      expect(role[0]).toEqual(plain[0]);
      expect(role[role.length - 1]).toEqual(plain[plain.length - 1]);
    }
  });

  /**
   * Axis-aligned legs cannot bow, so an orthogonal route falls back to moving
   * the ends apart -- which is also what keeps the roles in the same order
   * under either routing.
   */
  it("keeps the two roles apart on an orthogonal route", () => {
    const relationship = diamond(400, 0);
    const entity = node(0, 0);

    const first = drawnRoute(relationship, entity, "1", "centre", true);
    const last = drawnRoute(relationship, entity, "4", "centre", true);

    expect(first).not.toEqual(last);
    expect(first[0]).not.toEqual(last[0]);
    expect(first[first.length - 1]).not.toEqual(last[last.length - 1]);
    // the same order the bowed pair comes out in: "1" above, "4" below
    expect(first[0].y).toBeLessThan(last[0].y);
  });

  it("leaves an edge with no role on the line between the centres", () => {
    const points = drawnRoute(diamond(400, 0), node(0, 0), "", "centre", false);

    // both centres sit at y = 20, and so does an edge that is nobody's role
    expect(points).toHaveLength(2);
    expect(points[0].y).toBeCloseTo(20, 6);
    expect(points[1].y).toBeCloseTo(20, 6);
  });
});

/**
 * A bowed route has no corners to read back out of the path, so routePoints
 * walks the curve instead. Everything that reasons about a line rather than
 * drawing it -- the occlusion pass -- works from what comes back here, and a
 * curve reported as its chord would be a line the diagram never drew.
 */
describe("routePoints, bowed", () => {
  const from = { x: 0, y: 0 };
  const to = { x: 200, y: 0 };

  it("reports the curve rather than the chord", () => {
    const points = routePoints(
      false,
      from,
      to,
      Position.Right,
      Position.Left,
      20,
    );

    expect(points.length).toBeGreaterThan(2);
    expect(points[0]).toEqual(from);
    expect(points[points.length - 1]).toEqual(to);
    // widest half way along, by however much it was told to bow
    expect(points[Math.floor(points.length / 2)].y).toBeCloseTo(20, 6);
  });

  it("is still just the two ends when nothing bows", () => {
    expect(
      routePoints(false, from, to, Position.Right, Position.Left, 0),
    ).toEqual([from, to]);
  });
});
