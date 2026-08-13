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
import {
  Segment,
  diagramMetrics,
} from "../../../../src/app/util/layout/metrics";
import { EXAMPLES, fromErDoc } from "./fixtures";

const STRUCTURAL = ["entity", "relationship", "isA", "aggregation"];

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

  const segments: Segment[] = [];
  for (const edge of edges) {
    const a = centre(edge.source);
    const b = centre(edge.target);
    if (a !== null && b !== null) segments.push({ a, b });
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
  return diagramMetrics(structural, segments);
};

describe("layout quality", () => {
  const rows: Record<string, unknown>[] = [];

  for (const example of EXAMPLES) {
    describe(example.name, () => {
      const { nodes, edges } = fromErDoc(example.erDoc);
      const typedNodes = nodes as unknown as PositionedNode[];
      const positions = layoutDiscreteSearch(nodes, edges);
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

      rows.push({
        example: example.name,
        crossings: ours.crossings,
        humanCrossings: human?.crossings ?? "-",
        overlaps: ours.overlaps,
        humanOverlaps: human?.overlaps ?? "-",
        alignedEdges: `${ours.axisAlignedEdges}/${ours.edges}`,
        humanAligned: human ? `${human.axisAlignedEdges}/${human.edges}` : "-",
        areaMpx: Math.round(ours.area / 1e6),
        humanAreaMpx: human ? Math.round(human.area / 1e6) : "-",
      });

      it("never overlaps two structural elements", () => {
        expect(ours.overlaps).toBe(0);
      });

      it("draws a good share of its edges on an axis", () => {
        // the point of the whole exercise: alignment as a hard constraint should
        // beat a force simulation, which produces almost no axis-aligned edges
        expect(ours.axisAlignedEdges / ours.edges).toBeGreaterThan(0.3);
      });

      it("does not sprawl", () => {
        expect(ours.area).toBeLessThan(30e6);
      });
    });
  }

  afterAll(() => {
    // eslint-disable-next-line no-console
    console.table(rows);
  });
});
