/**
 * Regression over the five diagrams the app ships as examples.
 *
 * These run the real pipeline: ERdoc source -> parser -> erToReactflowElements
 * -> layout, so they cover the ids, aggregation re-parenting and edge
 * orientations the app actually produces, not a hand-made approximation.
 */

import {
  PositionedNode,
  Rect,
  toAbsoluteRects,
} from "../../../../src/app/util/alignmentCandidates";
import { layoutDiscreteSearch } from "../../../../src/app/util/layout";
import { minimumAggregationSize } from "../../../../src/app/util/layout/aggregationBox";
import {
  rectsOverlap,
  visualRectOf,
} from "../../../../src/app/util/layout/geometry";
import { DEFAULT_LAYOUT_PARAMS } from "../../../../src/app/util/layout/params";
import { EXAMPLES, fromErDoc, withSizes } from "./fixtures";

const STRUCTURAL = ["entity", "relationship", "isA", "aggregation"];

/** Absolute rectangles of the laid-out diagram, using what each node covers on screen. */
const laidOutRects = (
  nodes: PositionedNode[],
  positions: Map<string, { x: number; y: number }>,
): Rect[] => {
  const withPositions = nodes.map((node) => ({
    ...node,
    position: positions.get(node.id)!,
  }));
  const byId = new Map(withPositions.map((node) => [node.id, node]));
  return toAbsoluteRects(withPositions, { structuralOnly: false }).map((rect) =>
    visualRectOf(
      rect.id,
      byId.get(rect.id)!.type ?? "",
      { x: rect.x, y: rect.y },
      rect.width,
      rect.height,
    ),
  );
};

describe.each(EXAMPLES)("$name", ({ name, erDoc }) => {
  const { nodes, edges } = fromErDoc(erDoc);
  const { positions, sizes } = layoutDiscreteSearch(nodes, edges);
  // an aggregation must be measured at the box the layout cut for it, not the
  // one it was seeded with
  const sized = withSizes(nodes, sizes) as unknown as PositionedNode[];

  it("returns a position for every input node", () => {
    expect(positions.size).toBe(nodes.length);
    for (const node of nodes) expect(positions.has(node.id)).toBe(true);
  });

  it("returns finite coordinates", () => {
    for (const [id, position] of positions) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
      expect(id).toBeTruthy();
    }
  });

  it("puts the diagram in the positive quadrant", () => {
    const rects = laidOutRects(sized, positions);
    for (const rect of rects) {
      expect(rect.x).toBeGreaterThanOrEqual(0);
      expect(rect.y).toBeGreaterThanOrEqual(0);
    }
  });

  it("is deterministic", () => {
    const rerun = fromErDoc(erDoc);
    const again = layoutDiscreteSearch(rerun.nodes, rerun.edges);
    expect([...again.positions.entries()]).toEqual([...positions.entries()]);
    expect([...again.sizes.entries()]).toEqual([...sizes.entries()]);
  });

  it("leaves no two structural elements overlapping", () => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const rects = laidOutRects(sized, positions).filter((rect) =>
      STRUCTURAL.includes(byId.get(rect.id)?.type ?? ""),
    );

    const collisions: string[] = [];
    for (let i = 0; i < rects.length; i++)
      for (let j = i + 1; j < rects.length; j++) {
        const a = byId.get(rects[i].id)!;
        const b = byId.get(rects[j].id)!;
        // an aggregation legitimately contains its own members
        if (a.parentNode === b.id || b.parentNode === a.id) continue;
        if (rectsOverlap(rects[i], rects[j]))
          collisions.push(`${a.data?.erId} / ${b.data?.erId}`);
      }
    expect(collisions).toEqual([]);
  });

  it("keeps attributes clear of the element they belong to", () => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const rects = new Map(
      laidOutRects(sized, positions).map((rect) => [rect.id, rect]),
    );

    const overlapping: string[] = [];
    for (const node of nodes) {
      if (node.parentNode === undefined) continue;
      const parent = byId.get(node.parentNode);
      // aggregation members are meant to sit inside their container
      if (parent === undefined || parent.type === "aggregation") continue;
      if (rectsOverlap(rects.get(node.id)!, rects.get(parent.id)!))
        overlapping.push(`${node.data?.erId}`);
    }
    expect(overlapping).toEqual([]);
  });

  it("keeps aggregation members inside their container", () => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    for (const node of nodes) {
      const parent = node.parentNode ? byId.get(node.parentNode) : undefined;
      if (parent?.type !== "aggregation") continue;
      // React Flow clamps `extent: "parent"` children on drag, so a position
      // outside the box looks fine until the user touches it
      const box = sizes.get(parent.id)!;
      const position = positions.get(node.id)!;
      expect(position.x).toBeGreaterThanOrEqual(0);
      expect(position.y).toBeGreaterThanOrEqual(0);
      expect(position.x + (node.width ?? 0)).toBeLessThanOrEqual(box.width);
      expect(position.y + (node.height ?? 0)).toBeLessThanOrEqual(box.height);
    }
    expect(name).toBeTruthy();
  });

  /**
   * The invariant the whole feature rests on: a layout leaves every box at
   * exactly the size a manual resize is held to. If these two ever disagree,
   * the first shrink drag after a layout run jumps.
   */
  it("leaves every aggregation box at exactly its own minimum", () => {
    const placed = sized.map((node) => ({
      ...node,
      position: positions.get(node.id) ?? node.position,
    }));
    for (const [containerId, size] of sizes)
      expect(minimumAggregationSize(placed, containerId)).toEqual(size);
    expect(name).toBeTruthy();
  });
});

describe("edge cases", () => {
  it("returns an empty map for an empty diagram", () => {
    expect(layoutDiscreteSearch([], []).positions.size).toBe(0);
  });

  it("does not mutate the nodes it is given", () => {
    const { nodes, edges } = fromErDoc(EXAMPLES[1].erDoc);
    const before = JSON.stringify(nodes);
    layoutDiscreteSearch(nodes, edges);
    expect(JSON.stringify(nodes)).toBe(before);
  });

  it("honours a different grid step", () => {
    const { nodes, edges } = fromErDoc(EXAMPLES[3].erDoc);
    const coarse = layoutDiscreteSearch(nodes, edges, {
      ...DEFAULT_LAYOUT_PARAMS,
      gridStep: 100,
    });
    const fine = layoutDiscreteSearch(nodes, edges, DEFAULT_LAYOUT_PARAMS);
    expect([...coarse.positions.entries()]).not.toEqual([
      ...fine.positions.entries(),
    ]);
  });
});
