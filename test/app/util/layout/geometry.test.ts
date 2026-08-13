import { Rect } from "../../../../src/app/util/alignmentCandidates";
import {
  DIRECTIONS,
  TAU,
  angleOf,
  centroid,
  freeSectors,
  isOnGrid,
  normalizeAngle,
  rectAt,
  rectsOverlap,
  segmentsCross,
  snap,
  snapVec,
  visualSize,
} from "../../../../src/app/util/layout/geometry";

const rect = (id: string, x: number, y: number, width = 100, height = 50) =>
  ({ id, x, y, width, height }) as Rect;

describe("DIRECTIONS", () => {
  it("covers the 8 compass directions exactly once", () => {
    expect(DIRECTIONS).toHaveLength(8);
    const seen = new Set(DIRECTIONS.map((d) => `${d.x},${d.y}`));
    expect(seen.size).toBe(8);
  });

  it("lists the axis-aligned directions first, so ties prefer them", () => {
    const axisAligned = DIRECTIONS.slice(0, 4);
    expect(axisAligned.every((d) => d.x === 0 || d.y === 0)).toBe(true);
    expect(DIRECTIONS.slice(4).every((d) => d.x !== 0 && d.y !== 0)).toBe(true);
  });
});

describe("snap", () => {
  it("rounds to the nearest multiple of the step", () => {
    expect(snap(59, 60)).toBe(60);
    expect(snap(29, 60)).toBe(0);
    expect(snap(-31, 60)).toBe(-60);
  });

  it("snaps both components of a vector", () => {
    expect(snapVec({ x: 61, y: -119 }, 60)).toEqual({ x: 60, y: -120 });
  });

  it("recognises values that already sit on the grid", () => {
    expect(isOnGrid(120, 60)).toBe(true);
    expect(isOnGrid(121, 60)).toBe(false);
  });
});

describe("visualSize", () => {
  it("leaves untransformed elements alone", () => {
    expect(visualSize("entity", 120, 40)).toEqual({ width: 120, height: 40 });
  });

  // React Flow measures offsetWidth/offsetHeight, which ignores `rotate-45`.
  // A 95x95 diamond really covers its diagonal, ~134px.
  it("expands the rotated relationship diamond to its diagonal", () => {
    const { width, height } = visualSize("relationship", 95, 95);
    expect(width).toBeCloseTo(95 * Math.SQRT2, 6);
    expect(height).toBeCloseTo(95 * Math.SQRT2, 6);
  });
});

describe("rectAt", () => {
  it("builds a rectangle centred on the given point", () => {
    expect(rectAt("a", { x: 0, y: 0 }, 100, 50)).toEqual({
      id: "a",
      x: -50,
      y: -25,
      width: 100,
      height: 50,
    });
  });
});

describe("rectsOverlap", () => {
  it("detects a plain overlap", () => {
    expect(rectsOverlap(rect("a", 0, 0), rect("b", 50, 0))).toBe(true);
  });

  it("treats touching rectangles as clear when no gap is required", () => {
    expect(rectsOverlap(rect("a", 0, 0), rect("b", 100, 0))).toBe(false);
  });

  it("rejects rectangles that are closer than the required gap", () => {
    expect(rectsOverlap(rect("a", 0, 0), rect("b", 130, 0), 45)).toBe(true);
    expect(rectsOverlap(rect("a", 0, 0), rect("b", 145, 0), 45)).toBe(false);
  });

  it("is symmetric", () => {
    const a = rect("a", 0, 0);
    const b = rect("b", 120, 30);
    expect(rectsOverlap(a, b, 45)).toBe(rectsOverlap(b, a, 45));
  });
});

describe("segmentsCross", () => {
  it("finds a proper crossing", () => {
    expect(
      segmentsCross(
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 10 },
        { x: 10, y: 0 },
      ),
    ).toBe(true);
  });

  it("ignores segments that only share an endpoint", () => {
    // every attribute edge leaves from its owner, so shared endpoints are the
    // common case and must never be scored as crossings
    expect(
      segmentsCross(
        { x: 0, y: 0 },
        { x: 10, y: 10 },
        { x: 0, y: 0 },
        { x: 10, y: -10 },
      ),
    ).toBe(false);
  });

  it("ignores parallel and collinear segments", () => {
    expect(
      segmentsCross(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 0, y: 5 },
        { x: 10, y: 5 },
      ),
    ).toBe(false);
    expect(
      segmentsCross(
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 5, y: 0 },
        { x: 15, y: 0 },
      ),
    ).toBe(false);
  });

  it("ignores segments that miss each other", () => {
    expect(
      segmentsCross(
        { x: 0, y: 0 },
        { x: 1, y: 1 },
        { x: 100, y: 100 },
        { x: 101, y: 99 },
      ),
    ).toBe(false);
  });
});

describe("centroid", () => {
  it("averages the points", () => {
    expect(
      centroid([
        { x: 0, y: 0 },
        { x: 10, y: 20 },
        { x: 20, y: 10 },
      ]),
    ).toEqual({ x: 10, y: 10 });
  });

  it("returns the origin for no points", () => {
    expect(centroid([])).toEqual({ x: 0, y: 0 });
  });
});

describe("angles", () => {
  it("normalises into [0, 2pi)", () => {
    expect(normalizeAngle(-Math.PI / 2)).toBeCloseTo((3 * Math.PI) / 2, 6);
    expect(normalizeAngle(TAU)).toBeCloseTo(0, 6);
  });

  it("measures the direction from one point to another", () => {
    expect(angleOf({ x: 0, y: 0 }, { x: 1, y: 0 })).toBeCloseTo(0, 6);
    expect(angleOf({ x: 0, y: 0 }, { x: 0, y: 1 })).toBeCloseTo(Math.PI / 2, 6);
  });
});

describe("freeSectors", () => {
  it("returns the whole circle when nothing is occupied", () => {
    const [only] = freeSectors([]);
    expect(freeSectors([])).toHaveLength(1);
    expect(only.size).toBeCloseTo(TAU, 6);
  });

  it("leaves the whole circle minus a ray for a single occupied angle", () => {
    const sectors = freeSectors([0]);
    expect(sectors).toHaveLength(1);
    expect(sectors[0].size).toBeCloseTo(TAU, 6);
    expect(sectors[0].middle).toBeCloseTo(Math.PI, 6);
  });

  it("splits the circle between the occupied directions, widest first", () => {
    // edges leaving right and up-ish leave a wide gap towards the bottom left
    const sectors = freeSectors([0, Math.PI / 2]);
    expect(sectors).toHaveLength(2);
    expect(sectors[0].size).toBeCloseTo((3 * Math.PI) / 2, 6);
    expect(sectors[1].size).toBeCloseTo(Math.PI / 2, 6);
    expect(sectors[0].middle).toBeCloseTo((5 * Math.PI) / 4, 6);
  });

  it("collapses duplicate directions", () => {
    expect(freeSectors([0, 0, TAU])).toHaveLength(1);
  });
});
