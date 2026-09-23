/**
 * What the detector finds on the five shipped examples, once they are laid out.
 *
 * This is the gate the feature lives or dies by. An ER graph is usually not
 * planar, so a diagram that reads perfectly well still has edges crossing --
 * and if those produce marks, the user turns the feature off and the occlusions
 * it exists to show go back to being invisible. `bank` and `aggregation` each
 * carry a crossing the layout could not remove, so they are exactly the corpus
 * to prove that on.
 *
 * Edges are modelled centre to centre here rather than through the renderer's
 * handle geometry, which needs a measured DOM. That is the same model
 * `metricsBaseline` records `throughNodes` with, so the two numbers are
 * directly comparable -- and it means this suite measures the *layout*, while
 * `useOcclusions` is what gets the drawn line exactly right in the app.
 */

import {
  PositionedNode,
  toAbsoluteRects,
} from "../../../../src/app/util/alignmentCandidates";
import { buildContainerMap } from "../../../../src/app/util/erGraph";
import { layoutDiscreteSearch } from "../../../../src/app/util/layout";
import { outlinePolygon } from "../../../../src/app/util/nodeOutline";
import {
  Route,
  Shape,
  findOcclusions,
} from "../../../../src/app/util/occlusion";
import { EXAMPLES, fromErDoc, withSizes } from "./fixtures";

/** What `metricsBaseline` records for the same corpus and the same edge model. */
const THROUGH_NODES_BASELINE: Record<string, number> = {
  roles: 0,
  aggregation: 0,
  subclass: 0,
  bank: 0,
  company: 1,
};

const occlusionsOf = (
  nodes: PositionedNode[],
  edges: { id: string; source: string; target: string }[],
  positions: Map<string, { x: number; y: number }>,
) => {
  const placed = nodes.map((node) => ({
    ...node,
    position: positions.get(node.id) ?? node.position,
  }));
  const typeOf = new Map(placed.map((node) => [node.id, node.type ?? ""]));
  const containers = buildContainerMap(placed);

  const rects = toAbsoluteRects(placed, { structuralOnly: false });
  const centres = new Map(
    rects.map((rect) => [
      rect.id,
      { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
    ]),
  );

  const shapes: Shape[] = rects.map((rect) => {
    const type = typeOf.get(rect.id) ?? "";
    return {
      id: rect.id,
      polygon: outlinePolygon(
        { type, width: rect.width, height: rect.height },
        centres.get(rect.id)!,
      ),
      occludesEdges: type !== "aggregation",
      containerIds: containers.get(rect.id) ?? [],
    };
  });

  const routes: Route[] = edges.flatMap((edge) => {
    const from = centres.get(edge.source);
    const to = centres.get(edge.target);
    return from === undefined || to === undefined
      ? []
      : [
          {
            id: edge.id,
            sourceId: edge.source,
            targetId: edge.target,
            points: [from, to],
          },
        ];
  });

  return findOcclusions(shapes, routes);
};

describe("occlusions on the shipped examples", () => {
  const rows: Record<string, unknown>[] = [];

  for (const example of EXAMPLES) {
    describe(example.name, () => {
      const { nodes, edges } = fromErDoc(example.erDoc);
      const { positions, sizes } = layoutDiscreteSearch(nodes, edges);
      // aggregations are judged at the box the layout cut for them, not the
      // 500x500 they were seeded with
      const placed = withSizes(nodes, sizes) as unknown as PositionedNode[];

      const marks = occlusionsOf(placed, edges, positions);
      const shapeMarks = marks.filter((mark) => mark.kind === "shape");
      const edgeMarks = marks.filter((mark) => mark.kind === "edge");

      rows.push({
        example: example.name,
        shapes: shapeMarks.length,
        edges: edgeMarks.length,
        worst:
          shapeMarks.map((mark) => mark.id).join(", ") ||
          edgeMarks.map((mark) => mark.id).join(", ") ||
          "-",
      });

      it("hides nothing behind anything else", () => {
        expect(shapeMarks.map((mark) => mark.id)).toEqual([]);
      });

      it("swallows no more lines than the recorded baseline", () => {
        expect(edgeMarks.length).toBeLessThanOrEqual(
          THROUGH_NODES_BASELINE[example.name],
        );
      });
    });
  }

  afterAll(() => {
    // eslint-disable-next-line no-console
    console.table(rows);
  });
});
