/**
 * Objective quality of the layout, per example, against two references: the
 * hand-made arrangement shipped with each example, and a recorded baseline that
 * ratchets down as the algorithm improves.
 *
 * These numbers are the instrument the proposal's second objective asks for --
 * crossings, overlaps, area and edge length over a representative corpus.
 */

import {
  PositionedNode,
  Rect,
  toAbsoluteRects,
} from "../../../../src/app/util/alignmentCandidates";
import { findAggregatedNodeIds } from "../../../../src/app/util/erGraph";
import { layoutDiscreteSearch } from "../../../../src/app/util/layout";
import { buildLayoutGraph } from "../../../../src/app/util/layout/buildLayoutGraph";
import {
  DrawnSegment,
  diagramMetrics,
  edgesThroughNodes,
} from "../../../../src/app/util/layout/metrics";
import { DEFAULT_LAYOUT_PARAMS } from "../../../../src/app/util/layout/params";
import { layoutCost } from "../../../../src/app/util/layout/refine";
import { EXAMPLES, fromErDoc, withSizes } from "./fixtures";

const STRUCTURAL = ["entity", "relationship", "isA", "aggregation"];

/**
 * What each example measures today, as a ratchet.
 *
 * The gate this replaces was `area < 30e6`, which the largest example clears by
 * a factor of thirty-six: it could not catch anything the layout would plausibly
 * do wrong. These are the real numbers, so a change has to be argued for rather
 * than absorbed. `area` and `length` get a tolerance because they move
 * continuously with any spacing change; `crossings` and `throughNodes` are small
 * integers and are held exactly, upwards.
 */
const BASELINE: Record<
  string,
  { crossings: number; throughNodes: number; area: number; length: number }
> = {
  roles: { crossings: 0, throughNodes: 0, area: 23719, length: 568 },
  aggregation: { crossings: 1, throughNodes: 0, area: 399735, length: 1965 },
  subclass: { crossings: 0, throughNodes: 0, area: 1110144, length: 3627 },
  bank: { crossings: 1, throughNodes: 0, area: 1269857, length: 5766 },
  company: { crossings: 0, throughNodes: 1, area: 953857, length: 6058 },
};

/**
 * `aggregation` grew by a third and `bank` by a twentieth when the refinement
 * pass was made to honour the clearance the greedy pass had already paid for:
 * `rejectOccupied` will not put two attribute rings within a minimum of each
 * other, and until then a refinement was free to give that back. `bank` bought a
 * crossing with it (2 down to 1) and `company` came in a eighth smaller, so the
 * corpus is ahead on the two terms priced above area -- but the room is real,
 * and where it does not buy anything it simply costs.
 */

/** How far `area` and `totalEdgeLength` may drift before it needs explaining. */
const TOLERANCE = 0.15;

const measureLayout = (
  nodes: PositionedNode[],
  edges: { source: string; target: string }[],
  positions: Map<string, { x: number; y: number }>,
) => {
  const placed = nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
  const rects = toAbsoluteRects(placed, { structuralOnly: false });
  const byId = new Map(rects.map((rect) => [rect.id, rect]));
  const centre = (id: string) => {
    const rect = byId.get(id);
    return rect === undefined
      ? null
      : { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  };

  const segments: DrawnSegment[] = [];
  for (const edge of edges) {
    const a = centre(edge.source);
    const b = centre(edge.target);
    if (a !== null && b !== null)
      segments.push({ a, b, from: edge.source, to: edge.target });
  }

  // an aggregation's members are represented at the top level by the box that
  // contains them, so counting both would score every container as a collision
  const contained = findAggregatedNodeIds(placed);
  const structural: Rect[] = rects.filter(
    (rect) =>
      !contained.has(rect.id) &&
      STRUCTURAL.includes(
        placed.find((node) => node.id === rect.id)?.type ?? "",
      ),
  );
  const parentOf = new Map(placed.map((node) => [node.id, node.parentNode]));
  const structuralSegments = segments.filter(
    (segment) =>
      structural.some((rect) => rect.id === segment.from) &&
      structural.some((rect) => rect.id === segment.to),
  );

  return {
    ...diagramMetrics(structural, segments),
    throughNodes: edgesThroughNodes(
      structural,
      structuralSegments,
      (rectId, nodeId) => parentOf.get(nodeId) === rectId,
    ),
  };
};

describe("layout quality", () => {
  const rows: Record<string, unknown>[] = [];

  for (const example of EXAMPLES) {
    describe(example.name, () => {
      const { nodes, edges } = fromErDoc(example.erDoc);
      const { positions, sizes } = layoutDiscreteSearch(nodes, edges);
      // aggregations are scored at the box the layout cut for them
      const typedNodes = withSizes(nodes, sizes) as unknown as PositionedNode[];
      const ours = measureLayout(typedNodes, edges, positions);

      const humanPositions = new Map(
        example.humanPositions.map((entry) => [entry.id, entry.position]),
      );
      // the shipped layouts predate the current id scheme in some examples, so
      // only compare when every node is covered
      const humanCovers = nodes.every((node) => humanPositions.has(node.id));
      const human = humanCovers
        ? measureLayout(typedNodes, edges, humanPositions)
        : null;

      // what the search was actually minimising, term by term. Six weights tuned
      // against one scalar is not a calibration, it is a guess -- so the terms
      // are reported separately even though nothing asserts on them.
      // built from the sized nodes, not the raw ones: an aggregation container
      // is still carrying its seeded 500x500 in `nodes`, and a clearance rect
      // that big overlaps its neighbours and saturates every term at
      // OVERLAP_PENALTY
      const graph = buildLayoutGraph(
        typedNodes as never,
        edges as never,
        DEFAULT_LAYOUT_PARAMS,
      );
      const centres = new Map(
        typedNodes.map((node) => {
          const position = positions.get(node.id) ?? node.position;
          return [
            node.id,
            {
              x: position.x + (node.width ?? 0) / 2,
              y: position.y + (node.height ?? 0) / 2,
            },
          ];
        }),
      );
      const term = (only: keyof typeof DEFAULT_LAYOUT_PARAMS.weights) =>
        Math.round(
          layoutCost(graph, centres, {
            ...DEFAULT_LAYOUT_PARAMS,
            weights: Object.fromEntries(
              Object.entries(DEFAULT_LAYOUT_PARAMS.weights).map(
                ([key, value]) => [key, key === only ? value : 0],
              ),
            ) as typeof DEFAULT_LAYOUT_PARAMS.weights,
          }),
        );

      const baseline = BASELINE[example.name];

      rows.push({
        example: example.name,
        crossings: ours.crossings,
        humanCrossings: human?.crossings ?? "-",
        overlaps: ours.overlaps,
        throughNodes: ours.throughNodes,
        alignedEdges: `${ours.axisAlignedEdges}/${ours.edges}`,
        humanAligned: human ? `${human.axisAlignedEdges}/${human.edges}` : "-",
        area: Math.round(ours.area),
        length: Math.round(ours.totalEdgeLength),
        // the cost decomposition
        cCross: term("crossings"),
        cLength: term("length"),
        cCompact: term("compactness"),
        cAspect: term("aspect"),
        cUnalign: term("unaligned"),
        cIsaDown: term("isaDown"),
      });

      it("never overlaps two structural elements", () => {
        expect(ours.overlaps).toBe(0);
      });

      it("draws a good share of its edges on an axis", () => {
        // the point of the whole exercise: alignment as a hard constraint should
        // beat a force simulation, which produces almost no axis-aligned edges
        expect(ours.axisAlignedEdges / ours.edges).toBeGreaterThan(0.3);
      });

      it("draws no more edges through an element than it already does", () => {
        // an edge vanishing into a box it does not join is worse than a
        // crossing, which is at least legible -- and nothing in the cost
        // function can see it
        expect(ours.throughNodes).toBeLessThanOrEqual(baseline.throughNodes);
      });

      it("crosses no more edges than it already does", () => {
        expect(ours.crossings).toBeLessThanOrEqual(baseline.crossings);
      });

      it("stays within a sixth of the area and edge length it had", () => {
        expect(ours.area).toBeLessThan(baseline.area * (1 + TOLERANCE));
        expect(ours.totalEdgeLength).toBeLessThan(
          baseline.length * (1 + TOLERANCE),
        );
      });
    });
  }

  afterAll(() => {
    // eslint-disable-next-line no-console
    console.table(rows);
  });
});
