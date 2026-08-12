import {
  PositionedNode,
  Rect,
  distanceTo,
  findActiveCandidates,
  getAlignCandidates,
  getSpacingCandidates,
  toAbsoluteRects,
} from "../../../src/app/util/alignmentCandidates";

const rect = (
  id: string,
  x: number,
  y: number,
  width = 100,
  height = 50,
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
  height: 50,
  ...extra,
});

describe("toAbsoluteRects", () => {
  it("keeps top-level nodes where they are", () => {
    const rects = toAbsoluteRects([node("a", 10, 20)]);
    expect(rects).toEqual([{ id: "a", x: 10, y: 20, width: 100, height: 50 }]);
  });

  it("adds the parent offset to child nodes", () => {
    const rects = toAbsoluteRects(
      [
        node("parent", 100, 200, { type: "aggregation" }),
        node("child", 10, 20, { parentNode: "parent" }),
      ],
      { structuralOnly: false },
    );
    expect(rects.find((r) => r.id === "child")).toEqual({
      id: "child",
      x: 110,
      y: 220,
      width: 100,
      height: 50,
    });
  });

  it("drops hidden nodes so guides never point at something invisible", () => {
    const rects = toAbsoluteRects([
      node("visible", 0, 0),
      node("gone", 50, 50, { hidden: true }),
    ]);
    expect(rects.map((r) => r.id)).toEqual(["visible"]);
  });

  it("drops unmeasured nodes", () => {
    const rects = toAbsoluteRects([
      node("measured", 0, 0),
      node("unmeasured", 50, 50, { width: undefined, height: undefined }),
    ]);
    expect(rects.map((r) => r.id)).toEqual(["measured"]);
  });

  it("keeps only structural nodes by default", () => {
    const rects = toAbsoluteRects([
      node("entity", 0, 0),
      node("attr", 50, 50, { type: "entity-attribute" }),
    ]);
    expect(rects.map((r) => r.id)).toEqual(["entity"]);
  });

  it("does not loop forever on a cyclic parent chain", () => {
    const rects = toAbsoluteRects(
      [
        node("a", 10, 10, { parentNode: "b" }),
        node("b", 20, 20, { parentNode: "a" }),
      ],
      { structuralOnly: false },
    );
    expect(rects).toHaveLength(2);
  });
});

describe("getAlignCandidates", () => {
  it("proposes the centre line of another node on both axes", () => {
    const dragged = rect("d", 0, 0);
    const other = rect("o", 300, 400);
    const candidates = getAlignCandidates(dragged, [other]);

    // other's centre is (350, 425)
    expect(candidates).toContainEqual({
      axis: "x",
      value: 350,
      kind: "align",
      refIds: ["o"],
    });
    expect(candidates).toContainEqual({
      axis: "y",
      value: 425,
      kind: "align",
      refIds: ["o"],
    });
  });

  it("groups nodes sharing a centre line into one candidate", () => {
    const dragged = rect("d", 0, 0);
    const candidates = getAlignCandidates(dragged, [
      rect("a", 300, 0),
      rect("b", 300, 500),
    ]);
    const xCandidates = candidates.filter((c) => c.axis === "x");
    expect(xCandidates).toHaveLength(1);
    expect(xCandidates[0].refIds.sort()).toEqual(["a", "b"]);
  });
});

describe("getSpacingCandidates", () => {
  it("continues a run with the same gap", () => {
    // two 100-wide rects in the same row, 40px apart
    const first = rect("a", 0, 0);
    const second = rect("b", 140, 0);
    const dragged = rect("d", 400, 0);

    const candidates = getSpacingCandidates(dragged, [first, second]);
    const after = candidates.find((c) => c.axis === "x" && c.value > 200);

    // b ends at 240, + gap 40 => dragged left edge 280, centre 330
    expect(after).toEqual({
      axis: "x",
      value: 330,
      kind: "spacing",
      refIds: ["a", "b"],
      gap: 40,
    });
  });

  it("also proposes extending the run backwards", () => {
    const candidates = getSpacingCandidates(rect("d", -400, 0), [
      rect("a", 0, 0),
      rect("b", 140, 0),
    ]);
    // a starts at 0, - gap 40 => dragged right edge -40, centre -90
    expect(candidates).toContainEqual({
      axis: "x",
      value: -90,
      kind: "spacing",
      refIds: ["a", "b"],
      gap: 40,
    });
  });

  it("ignores pairs that are not in the same row", () => {
    // b sits far below, so there is no horizontal run to continue
    const candidates = getSpacingCandidates(rect("d", 400, 0), [
      rect("a", 0, 0),
      rect("b", 140, 9999),
    ]);
    expect(candidates.filter((c) => c.axis === "x")).toHaveLength(0);
  });

  it("ignores overlapping pairs", () => {
    const candidates = getSpacingCandidates(rect("d", 400, 0), [
      rect("a", 0, 0),
      rect("b", 50, 0),
    ]);
    expect(candidates.filter((c) => c.axis === "x")).toHaveLength(0);
  });

  it("works vertically too", () => {
    // two 50-tall rects in the same column, 30px apart
    const candidates = getSpacingCandidates(rect("d", 0, 500), [
      rect("a", 0, 0),
      rect("b", 0, 80),
    ]);
    // b ends at 130, + gap 30 => dragged top 160, centre 185
    expect(candidates).toContainEqual({
      axis: "y",
      value: 185,
      kind: "spacing",
      refIds: ["a", "b"],
      gap: 30,
    });
  });
});

describe("findActiveCandidates", () => {
  it("returns nothing when the dragged node is far from everything", () => {
    const active = findActiveCandidates(
      rect("d", 5000, 5000),
      [rect("a", 0, 0)],
      8,
    );
    expect(active).toEqual([]);
  });

  it("activates a guide once inside the tolerance", () => {
    // a's centre x is 50; put the dragged centre at 54 -> 4px away
    const active = findActiveCandidates(
      rect("d", 4, 900),
      [rect("a", 0, 0)],
      8,
    );
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({ axis: "x", value: 50, kind: "align" });
  });

  it("returns at most one candidate per axis", () => {
    const active = findActiveCandidates(
      rect("d", 4, 4),
      [rect("a", 0, 0), rect("b", 2, 2), rect("c", 6, 6)],
      50,
    );
    expect(active.filter((c) => c.axis === "x")).toHaveLength(1);
    expect(active.filter((c) => c.axis === "y")).toHaveLength(1);
  });

  it("picks the nearest candidate on each axis", () => {
    // centres at x=50 (far) and x=104 (near) for a dragged centre of 100
    const active = findActiveCandidates(
      rect("d", 50, 900),
      [rect("a", 0, 0), rect("b", 54, 0)],
      60,
    );
    const xCandidate = active.find((c) => c.axis === "x")!;
    expect(xCandidate.value).toBe(104);
  });

  it("can exclude spacing candidates", () => {
    const others = [rect("a", 0, 0), rect("b", 140, 0)];
    const dragged = rect("d", 280, 0);
    const withSpacing = findActiveCandidates(dragged, others, 10);
    const withoutSpacing = findActiveCandidates(dragged, others, 10, {
      includeSpacing: false,
    });
    expect(withSpacing.some((c) => c.kind === "spacing")).toBe(true);
    expect(withoutSpacing.some((c) => c.kind === "spacing")).toBe(false);
  });
});

describe("distanceTo", () => {
  it("measures from the dragged centre on the candidate's axis", () => {
    const dragged = rect("d", 0, 0); // centre (50, 25)
    expect(
      distanceTo(dragged, { axis: "x", value: 70, kind: "align", refIds: [] }),
    ).toBe(20);
    expect(
      distanceTo(dragged, { axis: "y", value: 5, kind: "align", refIds: [] }),
    ).toBe(20);
  });
});
