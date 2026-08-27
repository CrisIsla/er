import {
  DEFAULT_AGGREGATION_SIZE,
  isFiniteSize,
  readNodeSize,
  withNodeSize,
} from "../../../src/app/util/nodeSize";

describe("isFiniteSize", () => {
  it("accepts a pair of positive numbers", () => {
    expect(isFiniteSize(300, 200)).toBe(true);
  });

  it.each([
    ["a missing value", 300, undefined],
    ["a string", "300", 200],
    ["a percentage", "100%", "100%"],
    ["zero", 0, 200],
    ["a negative", 300, -1],
    ["NaN", Number.NaN, 200],
    ["Infinity", Number.POSITIVE_INFINITY, 200],
  ])("rejects %s", (_label, width, height) => {
    expect(isFiniteSize(width, height)).toBe(false);
  });
});

describe("readNodeSize", () => {
  it("returns the authored size", () => {
    expect(readNodeSize({ style: { width: 640, height: 480 } })).toEqual({
      width: 640,
      height: 480,
    });
  });

  // the guarantee the whole no-flag design rests on: a node that merely got
  // measured must never look like a node somebody sized
  it("returns null for a node React Flow only measured", () => {
    expect(readNodeSize({ width: 90, height: 44 })).toBeNull();
  });

  it("returns null for a node with no size at all", () => {
    expect(readNodeSize({})).toBeNull();
  });

  it("returns null for a non-numeric style size", () => {
    expect(readNodeSize({ style: { width: "100%", height: 480 } })).toBeNull();
  });
});

describe("withNodeSize", () => {
  it("writes both size channels", () => {
    const node = withNodeSize(
      { id: "0", width: null, height: null },
      { width: 640, height: 480 },
    );
    expect(node).toEqual({
      id: "0",
      width: 640,
      height: 480,
      style: { width: 640, height: 480 },
    });
  });

  // the rebuild sets `opacity: 1` on new nodes one line before the size lands
  it("keeps the rest of the style", () => {
    const node = withNodeSize(
      { style: { opacity: 1, width: 500, height: 500 } },
      { width: 640, height: 480 },
    );
    expect(node.style).toEqual({ opacity: 1, width: 640, height: 480 });
  });

  it("round-trips through readNodeSize", () => {
    const size = { width: 321, height: 123 };
    expect(readNodeSize(withNodeSize({}, size))).toEqual(size);
  });

  it("does not mutate the node it is given", () => {
    const original = { width: 500, height: 500, style: { width: 500 } };
    const before = JSON.stringify(original);
    withNodeSize(original, DEFAULT_AGGREGATION_SIZE);
    expect(JSON.stringify(original)).toBe(before);
  });
});
