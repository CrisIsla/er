import { buildLayoutGraph } from "../../../../src/app/util/layout/buildLayoutGraph";
import {
  isOnGrid,
  rectsOverlap,
} from "../../../../src/app/util/layout/geometry";
import {
  clearanceRect,
  generateCandidates,
  keepMostAligned,
  placeSkeleton,
  relaxations,
  seedOrder,
} from "../../../../src/app/util/layout/placement";
import { DEFAULT_LAYOUT_PARAMS } from "../../../../src/app/util/layout/params";
import { Placement } from "../../../../src/app/util/layout/types";
import { EXAMPLES, fromErDoc } from "./fixtures";

const params = DEFAULT_LAYOUT_PARAMS;

const graphOf = (source: string) => {
  const { nodes, edges } = fromErDoc(source);
  return buildLayoutGraph(nodes, edges, params);
};

describe("seedOrder", () => {
  it("puts the heaviest element first", () => {
    const graph = graphOf(`
      entity Hub {
        id key
        a
        b
        c
      }
      entity Leaf { id key }
      relation r1(Hub, Leaf)
    `);
    expect(seedOrder(graph)[0].key).toBe("entity: Hub");
  });

  it("breaks ties on a stable name, not on array order", () => {
    const graph = graphOf(`
      entity Bravo { id key }
      entity Alpha { id key }
    `);
    expect(seedOrder(graph).map((element) => element.key)).toEqual([
      "entity: Alpha",
      "entity: Bravo",
    ]);
  });
});

describe("generateCandidates", () => {
  const graph = graphOf(`
    entity A { id key }
    entity B { id key }
    relation r(A, B)
  `);
  const [a, b] = seedOrder(graph);
  const centres: Placement = new Map([[a.id, { x: 0, y: 0 }]]);
  const relaxation = relaxations(params)[0];

  const candidates = generateCandidates(
    b,
    [a.id],
    centres,
    graph,
    new Map(),
    params,
    relaxation,
  );

  it("only proposes whole grid steps from the anchor", () => {
    expect(candidates.length).toBeGreaterThan(0);
    for (const candidate of candidates) {
      expect(isOnGrid(candidate.x, params.gridStep)).toBe(true);
      expect(isOnGrid(candidate.y, params.gridStep)).toBe(true);
    }
  });

  it("offers one run per direction", () => {
    expect(candidates).toHaveLength(8 * relaxation.maxSteps);
  });

  it("never proposes a position that overlaps the anchor", () => {
    const anchorRect = clearanceRect(
      a,
      { x: 0, y: 0 },
      params,
      params.haloFactor,
    );
    for (const candidate of candidates) {
      const rect = clearanceRect(b, candidate, params, params.haloFactor);
      expect(rectsOverlap(rect, anchorRect)).toBe(false);
    }
  });

  it("starts far enough out to clear a 500x500 aggregation box", () => {
    const withAggregation = graphOf(`
      entity Library { name key }
      entity Book { bid key }
      entity Author { id key }
      relation Writes(Author, Book 1!)
      aggregation Book_written_by_Author(Writes)
      relation Contains(Library, Book_written_by_Author 1)
    `);
    const container = withAggregation.skeleton.find(
      (element) => element.key === "entity: Book_written_by_Author",
    )!;
    const library = withAggregation.skeleton.find(
      (element) => element.key === "entity: Library",
    )!;
    const proposals = generateCandidates(
      library,
      [container.id],
      new Map([[container.id, { x: 0, y: 0 }]]),
      withAggregation,
      new Map(),
      params,
      relaxation,
    );
    const containerRect = clearanceRect(
      container,
      { x: 0, y: 0 },
      params,
      params.haloFactor,
    );
    for (const candidate of proposals)
      expect(
        rectsOverlap(
          clearanceRect(library, candidate, params, params.haloFactor),
          containerRect,
        ),
      ).toBe(false);
  });
});

describe("keepMostAligned", () => {
  const centres: Placement = new Map([
    ["a", { x: 0, y: 0 }],
    ["b", { x: 300, y: 300 }],
  ]);

  it("keeps only the candidates that line up with the most anchors", () => {
    const candidates = [
      { x: 0, y: 300 }, // shares x with a and y with b: two alignments
      { x: 0, y: 900 }, // shares x with a only
      { x: 120, y: 660 }, // shares nothing
    ];
    expect(keepMostAligned(candidates, ["a", "b"], centres)).toEqual([
      { x: 0, y: 300 },
    ]);
  });

  it("keeps every candidate when none of them align", () => {
    const candidates = [
      { x: 120, y: 660 },
      { x: 180, y: 720 },
    ];
    expect(keepMostAligned(candidates, ["a", "b"], centres)).toHaveLength(2);
  });

  it("is a no-op on an empty list", () => {
    expect(keepMostAligned([], ["a"], centres)).toEqual([]);
  });
});

describe("placeSkeleton", () => {
  it("puts the seed at the origin", () => {
    const graph = graphOf(`
      entity Hub {
        id key
        a
        b
      }
      entity Leaf { id key }
      relation r(Hub, Leaf)
    `);
    const centres = placeSkeleton(graph, params);
    const hub = graph.skeleton.find(
      (element) => element.key === "entity: Hub",
    )!;
    expect(centres.get(hub.id)).toEqual({ x: 0, y: 0 });
  });

  it("handles a diagram with a single entity", () => {
    const graph = graphOf(EXAMPLES[0].erDoc);
    const centres = placeSkeleton(graph, params);
    expect(centres.size).toBe(1);
    expect(centres.get(graph.skeleton[0].id)).toEqual({ x: 0, y: 0 });
  });

  it("places disconnected components instead of hanging", () => {
    const graph = graphOf(`
      entity A { id key }
      entity B { id key }
      entity C { id key }
      relation r(A, B)
    `);
    const centres = placeSkeleton(graph, params);
    expect(centres.size).toBe(3);
    for (const element of graph.skeleton)
      expect(Number.isFinite(centres.get(element.id)!.x)).toBe(true);
  });

  it("copes with an empty diagram", () => {
    const graph = graphOf(``);
    expect(placeSkeleton(graph, params).size).toBe(0);
  });

  describe.each(EXAMPLES)("$name", ({ erDoc }) => {
    const graph = graphOf(erDoc);
    const centres = placeSkeleton(graph, params);

    it("places every skeleton element at a finite position", () => {
      expect(centres.size).toBe(graph.skeleton.length);
      for (const element of graph.skeleton) {
        const centre = centres.get(element.id)!;
        expect(Number.isFinite(centre.x)).toBe(true);
        expect(Number.isFinite(centre.y)).toBe(true);
      }
    });

    it("keeps every element on the same global grid", () => {
      for (const centre of centres.values()) {
        expect(isOnGrid(centre.x, params.gridStep)).toBe(true);
        expect(isOnGrid(centre.y, params.gridStep)).toBe(true);
      }
    });

    it("leaves no two elements overlapping", () => {
      const rects = graph.skeleton.map((element) =>
        clearanceRect(element, centres.get(element.id)!, params, 0),
      );
      for (let i = 0; i < rects.length; i++)
        for (let j = i + 1; j < rects.length; j++)
          expect(rectsOverlap(rects[i], rects[j])).toBe(false);
    });

    it("is deterministic", () => {
      const again = placeSkeleton(graphOf(erDoc), params);
      expect([...again.entries()].sort()).toEqual(
        [...centres.entries()].sort(),
      );
    });

    it("lines most elements up with a neighbour", () => {
      if (graph.skeleton.length < 2) return;
      const aligned = graph.skeleton.filter((element) => {
        const centre = centres.get(element.id)!;
        return graph.skeleton.some((other) => {
          if (other.id === element.id) return false;
          const otherCentre = centres.get(other.id)!;
          return centre.x === otherCentre.x || centre.y === otherCentre.y;
        });
      });
      expect(aligned.length / graph.skeleton.length).toBeGreaterThanOrEqual(
        0.8,
      );
    });
  });
});
