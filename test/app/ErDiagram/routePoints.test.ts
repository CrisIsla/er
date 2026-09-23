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
});
