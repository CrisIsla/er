/**
 * How the layout draws ISA hierarchies.
 *
 * The measures live in metrics.ts beside the general ones, so these read the
 * same way the quality suite does: run the real pipeline, then ask whether the
 * arrangement has the property a reader expects of an inheritance tree.
 */

import { layoutDiscreteSearch } from "../../../../src/app/util/layout";
import { buildLayoutGraph } from "../../../../src/app/util/layout/buildLayoutGraph";
import { buildHierarchyForest } from "../../../../src/app/util/layout/hierarchy";
import { hierarchyMetrics } from "../../../../src/app/util/layout/metrics";
import { isOnGrid } from "../../../../src/app/util/layout/geometry";
import { DEFAULT_LAYOUT_PARAMS } from "../../../../src/app/util/layout/params";
import { EXAMPLES, HIERARCHY_ERDOC, fromErDoc } from "./fixtures";

/** The pipeline's own frame: absolute centres, which is what the metrics want. */
const layoutOf = (erDoc: string) => {
  const { nodes, edges } = fromErDoc(erDoc);
  const graph = buildLayoutGraph(nodes, edges, DEFAULT_LAYOUT_PARAMS);
  const { positions } = layoutDiscreteSearch(nodes, edges);
  const centres = new Map(
    nodes.map((node) => {
      const position = positions.get(node.id)!;
      return [
        node.id,
        {
          x: position.x + (node.width ?? 0) / 2,
          y: position.y + (node.height ?? 0) / 2,
        },
      ];
    }),
  );
  return { nodes, edges, graph, centres, order: nodes.map((node) => node.id) };
};

/** erToReactflowElements carries a label the layout's own node type does not. */
const labelOf = (nodes: { id: string }[], id: string) => {
  const node = nodes.find((candidate) => candidate.id === id) as
    | { data?: { label?: string } }
    | undefined;
  return node?.data?.label ?? id;
};

describe("the ISA forest", () => {
  it("reads one link per subclass, pointed at the superclass", () => {
    const { graph, nodes, order } = layoutOf(HIERARCHY_ERDOC);
    const forest = buildHierarchyForest(graph, order);

    expect(forest.links).toHaveLength(4);
    expect(forest.roots.map((id) => labelOf(nodes, id))).toEqual(["Vehicle"]);
    expect(
      (forest.childrenOf.get(forest.roots[0]) ?? []).map((id) =>
        labelOf(nodes, id),
      ),
    ).toEqual(["Car", "Truck", "Motorcycle"]);
  });

  it("numbers the layers from the root down", () => {
    const { graph, nodes, order } = layoutOf(HIERARCHY_ERDOC);
    const forest = buildHierarchyForest(graph, order);
    const byLabel = new Map(
      [...forest.layerOf].map(([id, layer]) => [labelOf(nodes, id), layer]),
    );
    expect(byLabel.get("Vehicle")).toBe(0);
    expect(byLabel.get("Car")).toBe(1);
    expect(byLabel.get("Truck")).toBe(1);
    expect(byLabel.get("Semi")).toBe(2);
  });

  it("orders siblings the way the ERdoc declares them, not alphabetically", () => {
    // alphabetical would be Car, Motorcycle, Truck
    const { graph, nodes, order } = layoutOf(HIERARCHY_ERDOC);
    const forest = buildHierarchyForest(graph, order);
    const children = (forest.childrenOf.get(forest.roots[0]) ?? []).map((id) =>
      labelOf(nodes, id),
    );
    expect(children).not.toEqual([...children].sort());
  });

  it("drops the link that closes an inheritance cycle rather than hanging", () => {
    // only a lint error, so the layout has to survive it on its own
    const { graph, order } = layoutOf(`
      entity Dog extends Animal {}
      entity Animal extends Dog {}
    `);
    const forest = buildHierarchyForest(graph, order);
    expect(forest.links.length).toBeLessThanOrEqual(1);
    expect(forest.roots.length).toBeLessThanOrEqual(1);
  });

  it("finds nothing in a diagram with no inheritance", () => {
    const { graph, order } = layoutOf(EXAMPLES[0].erDoc);
    expect(buildHierarchyForest(graph, order).links).toHaveLength(0);
  });
});

describe("hierarchies in the shipped examples", () => {
  for (const example of EXAMPLES) {
    const { graph, centres, order } = layoutOf(example.erDoc);
    const metrics = hierarchyMetrics(graph, centres, order);
    if (metrics.links === 0) continue;

    describe(example.name, () => {
      it("draws every subclass below its superclass", () => {
        expect(metrics.downward).toBe(metrics.links);
      });
    });
  }
});

describe("a hierarchy whose members are also in relationships", () => {
  const { graph, centres, order } = layoutOf(HIERARCHY_ERDOC);
  const metrics = hierarchyMetrics(graph, centres, order);

  it("draws every subclass below its superclass", () => {
    expect(metrics.downward).toBe(metrics.links);
  });
});

/**
 * The shape itself, on the two diagrams with a fan to draw. These are the
 * properties a reader recognises as a tree, as opposed to a column that happens
 * to run downwards.
 */
describe.each([
  ["subclass", EXAMPLES[2].erDoc],
  ["a hierarchy with relationships", HIERARCHY_ERDOC],
])("%s, drawn as a tree", (_name, erDoc) => {
  const { graph, centres, order, nodes } = layoutOf(erDoc);
  const forest = buildHierarchyForest(graph, order);

  it("puts every subclass of one superclass on a single row", () => {
    expect(hierarchyMetrics(graph, centres, order).layerSpread).toBe(0);
  });

  it("centres a superclass over its subclasses", () => {
    for (const [parentId, children] of forest.childrenOf) {
      const xs = children.map((id) => centres.get(id)!.x);
      expect(centres.get(parentId)!.x).toBe(
        (Math.min(...xs) + Math.max(...xs)) / 2,
      );
    }
  });

  it("spaces the subclasses of one superclass evenly", () => {
    for (const children of forest.childrenOf.values()) {
      if (children.length < 3) continue;
      const xs = children.map((id) => centres.get(id)!.x).sort((a, b) => a - b);
      const gaps = xs.slice(1).map((x, index) => x - xs[index]);
      expect(new Set(gaps).size).toBe(1);
    }
  });

  it("keeps every member on the grid the search reasons about", () => {
    // the whole algorithm rests on every centre being a whole number of grid
    // steps from every other, which is why `isAligned` can be an exact test.
    // Measured against a member rather than the axes: the finished diagram is
    // shifted into the positive quadrant by a margin that is not itself a whole
    // step, so it is the lattice that has to survive, not the coordinates.
    const { gridStep } = DEFAULT_LAYOUT_PARAMS;
    const origin = centres.get(forest.roots[0])!;
    for (const id of forest.layerOf.keys()) {
      const centre = centres.get(id)!;
      expect(isOnGrid(centre.x - origin.x, gridStep)).toBe(true);
      expect(isOnGrid(centre.y - origin.y, gridStep)).toBe(true);
    }
    expect(nodes.length).toBeGreaterThan(0);
  });
});

describe("turning the tree pass off", () => {
  const treeless = {
    ...DEFAULT_LAYOUT_PARAMS,
    hierarchy: { ...DEFAULT_LAYOUT_PARAMS.hierarchy, enabled: false },
  };

  it("gives the search back a hierarchy it cannot fan", () => {
    const { nodes, edges } = fromErDoc(EXAMPLES[2].erDoc);
    const off = layoutDiscreteSearch(nodes, edges, treeless);
    const on = layoutDiscreteSearch(nodes, edges);
    expect([...off.positions.entries()]).not.toEqual([
      ...on.positions.entries(),
    ]);
  });

  it("changes nothing on a diagram with no inheritance", () => {
    const { nodes, edges } = fromErDoc(EXAMPLES[0].erDoc);
    expect([
      ...layoutDiscreteSearch(nodes, edges, treeless).positions.entries(),
    ]).toEqual([...layoutDiscreteSearch(nodes, edges).positions.entries()]);
  });
});
