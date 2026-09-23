/**
 * Where the overlay puts itself.
 *
 * Only the positional half is tested, the way `AttributeTooltip` splits reading
 * the graph from drawing the box: this is the arithmetic that fails silently --
 * an svg sized wrong paints nothing outside its own viewport and says nothing
 * about it -- while the drawing itself is a handful of static attributes.
 */

import { frameOf } from "../../../src/app/components/ErDiagram/OcclusionOverlay";
import { Occlusion } from "../../../src/app/util/occlusion";

const shapeMark = (
  x: number,
  y: number,
  width = 40,
  height = 40,
): Occlusion => ({
  id: `shape:a|b@${x},${y}`,
  kind: "shape",
  between: ["a", "b"],
  polygon: [
    { x, y },
    { x: x + width, y },
    { x: x + width, y: y + height },
    { x, y: y + height },
  ],
});

const edgeMark = (
  from: { x: number; y: number },
  to: { x: number; y: number },
): Occlusion => ({
  id: "edge:e|s",
  kind: "edge",
  edgeId: "e",
  sourceId: "from",
  targetId: "to",
  shapeId: "s",
  spans: [[from, to]],
});

describe("frameOf", () => {
  it("has nothing to place when nothing is hidden", () => {
    expect(frameOf([], 1)).toBeNull();
  });

  it("covers every mark, whichever kind they are", () => {
    const box = frameOf(
      [shapeMark(100, 100), edgeMark({ x: 400, y: 50 }, { x: 500, y: 50 })],
      1,
    )!;

    expect(box.x).toBeLessThan(100);
    expect(box.y).toBeLessThan(50);
    expect(box.x + box.width).toBeGreaterThan(500);
    expect(box.y + box.height).toBeGreaterThan(140);
  });

  /**
   * Flow coordinates go negative as soon as anything is dragged left of the
   * origin, so the svg has to be placed at the corner of the marks rather than
   * at 0,0 -- and the viewBox the caller builds from this starts there too.
   */
  it("follows the marks left of the flow origin", () => {
    const box = frameOf([shapeMark(-800, -600)], 1)!;

    expect(box.x).toBeLessThan(-800);
    expect(box.y).toBeLessThan(-600);
    expect(box.width).toBeGreaterThan(40);
  });

  /**
   * The overlay is scaled by the viewport's own CSS transform, so a stroke
   * measured in flow units thins with the zoom. Zoomed out hunting for problems
   * is when a mark most needs to still be there.
   */
  it("thickens the stroke as the diagram shrinks", () => {
    const marks = [shapeMark(0, 0)];

    expect(frameOf(marks, 0.25)!.stroke).toBeCloseTo(
      frameOf(marks, 1)!.stroke * 4,
      6,
    );
    expect(frameOf(marks, 2)!.stroke).toBeCloseTo(
      frameOf(marks, 1)!.stroke / 2,
      6,
    );
  });

  it("leaves room around the marks for the stroke to sit in", () => {
    const box = frameOf([shapeMark(0, 0, 40, 40)], 1)!;

    expect(box.x).toBeLessThan(0 - box.stroke);
    expect(box.width).toBeGreaterThan(40 + box.stroke * 2);
  });

  it("places nothing at a zoom that would divide by zero", () => {
    expect(frameOf([shapeMark(0, 0)], 0)).toBeNull();
  });
});
