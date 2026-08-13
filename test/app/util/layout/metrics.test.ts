import { Rect } from "../../../../src/app/util/alignmentCandidates";
import {
  boundingBox,
  countAlignedPairs,
  countAxisAligned,
  countCrossings,
  countOverlaps,
  diagramMetrics,
  isAxisAligned,
  totalLength,
} from "../../../../src/app/util/layout/metrics";

const rect = (id: string, x: number, y: number, width = 100, height = 50) =>
  ({ id, x, y, width, height }) as Rect;

const segment = (ax: number, ay: number, bx: number, by: number) => ({
  a: { x: ax, y: ay },
  b: { x: bx, y: by },
});

describe("countCrossings", () => {
  it("counts each crossing pair once", () => {
    expect(countCrossings([segment(0, 0, 10, 10), segment(0, 10, 10, 0)])).toBe(
      1,
    );
  });

  it("does not count a star of edges leaving one element", () => {
    const star = [
      segment(0, 0, 10, 0),
      segment(0, 0, 0, 10),
      segment(0, 0, -10, 0),
      segment(0, 0, 0, -10),
    ];
    expect(countCrossings(star)).toBe(0);
  });

  it("returns 0 for fewer than two segments", () => {
    expect(countCrossings([])).toBe(0);
    expect(countCrossings([segment(0, 0, 1, 1)])).toBe(0);
  });
});

describe("totalLength", () => {
  it("adds up the segment lengths", () => {
    expect(totalLength([segment(0, 0, 3, 4), segment(0, 0, 0, 10)])).toBe(15);
  });
});

describe("axis alignment", () => {
  it("accepts horizontal and vertical segments", () => {
    expect(isAxisAligned(segment(0, 0, 100, 0))).toBe(true);
    expect(isAxisAligned(segment(0, 0, 0, 100))).toBe(true);
  });

  it("rejects a diagonal", () => {
    expect(isAxisAligned(segment(0, 0, 100, 100))).toBe(false);
  });

  it("counts the aligned ones", () => {
    expect(
      countAxisAligned([segment(0, 0, 10, 0), segment(0, 0, 10, 10)]),
    ).toBe(1);
  });
});

describe("boundingBox", () => {
  it("covers every rectangle", () => {
    expect(boundingBox([rect("a", 0, 0), rect("b", 100, 100)])).toEqual({
      x: 0,
      y: 0,
      width: 200,
      height: 150,
    });
  });

  it("is empty for no rectangles", () => {
    expect(boundingBox([])).toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });
});

describe("countOverlaps", () => {
  it("counts overlapping pairs", () => {
    expect(countOverlaps([rect("a", 0, 0), rect("b", 50, 0)])).toBe(1);
  });

  it("counts pairs that are merely too close when a gap is required", () => {
    expect(countOverlaps([rect("a", 0, 0), rect("b", 120, 0)], 45)).toBe(1);
    expect(countOverlaps([rect("a", 0, 0), rect("b", 120, 0)])).toBe(0);
  });
});

describe("countAlignedPairs", () => {
  it("counts rectangles sharing a centre line", () => {
    // same centre x, far apart vertically
    expect(countAlignedPairs([rect("a", 0, 0), rect("b", 0, 400)])).toBe(1);
  });

  it("ignores rectangles that share neither centre line", () => {
    expect(countAlignedPairs([rect("a", 0, 0), rect("b", 37, 400)])).toBe(0);
  });
});

describe("diagramMetrics", () => {
  it("reports every measure at once", () => {
    const metrics = diagramMetrics(
      [rect("a", 0, 0), rect("b", 0, 400)],
      [segment(50, 25, 50, 425)],
    );
    expect(metrics).toEqual({
      crossings: 0,
      overlaps: 0,
      area: 100 * 450,
      totalEdgeLength: 400,
      edges: 1,
      axisAlignedEdges: 1,
      alignedPairs: 1,
    });
  });
});
