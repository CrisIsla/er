import { buildLayoutGraph } from "../../../../src/app/util/layout/buildLayoutGraph";
import { isOnGrid } from "../../../../src/app/util/layout/geometry";
import { DEFAULT_LAYOUT_PARAMS } from "../../../../src/app/util/layout/params";
import { placeSkeleton } from "../../../../src/app/util/layout/placement";
import {
  createRng,
  layoutCost,
  refinePlacement,
} from "../../../../src/app/util/layout/refine";
import { EXAMPLES, fromErDoc } from "./fixtures";

const params = DEFAULT_LAYOUT_PARAMS;

const setup = (source: string) => {
  const { nodes, edges } = fromErDoc(source);
  const graph = buildLayoutGraph(nodes, edges, params);
  return { graph, placed: placeSkeleton(graph, params) };
};

const company = EXAMPLES[4].erDoc;

describe("createRng", () => {
  it("gives the same sequence for the same seed", () => {
    const a = createRng(7);
    const b = createRng(7);
    const first = [a(), a(), a()];
    const second = [b(), b(), b()];
    expect(first).toEqual(second);
  });

  it("gives different sequences for different seeds", () => {
    expect(createRng(1)()).not.toBe(createRng(2)());
  });

  it("stays within [0, 1)", () => {
    const random = createRng(42);
    for (let i = 0; i < 200; i++) {
      const value = random();
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("refinePlacement", () => {
  it("never returns an arrangement worse than the one it was given", () => {
    for (const example of EXAMPLES) {
      const { graph, placed } = setup(example.erDoc);
      const before = layoutCost(graph, placed, params);
      const after = layoutCost(
        graph,
        refinePlacement(graph, placed, params),
        params,
      );
      expect(after).toBeLessThanOrEqual(before);
    }
  });

  it("is deterministic", () => {
    const first = setup(company);
    const second = setup(company);
    expect([
      ...refinePlacement(first.graph, first.placed, params).entries(),
    ]).toEqual([
      ...refinePlacement(second.graph, second.placed, params).entries(),
    ]);
  });

  it("never costs an element an alignment it already had", () => {
    const { graph, placed } = setup(company);
    const refined = refinePlacement(graph, placed, params);

    const alignments = (centres: Map<string, { x: number; y: number }>) =>
      new Map(
        graph.skeleton.map((element) => {
          const centre = centres.get(element.id)!;
          const count = (graph.neighbours.get(element.id) ?? []).filter(
            (neighbourId) => {
              const other = centres.get(neighbourId)!;
              return other.x === centre.x || other.y === centre.y;
            },
          ).length;
          return [element.id, count];
        }),
      );

    const before = alignments(placed);
    const after = alignments(refined);
    for (const [id, count] of before)
      expect(after.get(id)).toBeGreaterThanOrEqual(count);
  });

  it("keeps every element on the grid", () => {
    const { graph, placed } = setup(company);
    for (const centre of refinePlacement(graph, placed, params).values()) {
      expect(isOnGrid(centre.x, params.gridStep)).toBe(true);
      expect(isOnGrid(centre.y, params.gridStep)).toBe(true);
    }
  });

  it("stops when the time budget is spent", () => {
    const { graph, placed } = setup(company);
    let clock = 0;
    // jumps past the budget on the very first check
    const refined = refinePlacement(graph, placed, params, {
      now: () => (clock += 10_000),
    });
    expect([...refined.entries()]).toEqual([...placed.entries()]);
  });

  it("still terminates when the clock never advances", () => {
    const { graph, placed } = setup(company);
    const refined = refinePlacement(graph, placed, params, { now: () => 0 });
    expect(refined.size).toBe(placed.size);
  });

  it("is a no-op when disabled", () => {
    const { graph, placed } = setup(company);
    const refined = refinePlacement(graph, placed, {
      ...params,
      refine: { ...params.refine, enabled: false },
    });
    expect(refined).toBe(placed);
  });

  it("leaves a diagram too small to rearrange alone", () => {
    const { graph, placed } = setup(EXAMPLES[0].erDoc);
    expect(refinePlacement(graph, placed, params)).toBe(placed);
  });
});
