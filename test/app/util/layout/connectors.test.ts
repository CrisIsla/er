import {
  PositionedNode,
  toAbsoluteRects,
} from "../../../../src/app/util/alignmentCandidates";
import { layoutDiscreteSearch } from "../../../../src/app/util/layout";
import {
  findFreeSpot,
  gapCentre,
} from "../../../../src/app/util/layout/connectors";
import { visualRectOf } from "../../../../src/app/util/layout/geometry";
import { DEFAULT_LAYOUT_PARAMS } from "../../../../src/app/util/layout/params";
import { EXAMPLES, fromErDoc, withSizes } from "./fixtures";

const participant = (x: number, y: number, width = 90, height = 44) => ({
  centre: { x, y },
  width,
  height,
});

const DIAMOND = { width: 134, height: 134 };

/** Edge-to-edge gap between the connector at `v` and a participant. */
const gapTo = (
  v: { x: number; y: number },
  p: ReturnType<typeof participant>,
  connector = DIAMOND,
) =>
  Math.max(
    Math.abs(v.x - p.centre.x) - (connector.width + p.width) / 2,
    Math.abs(v.y - p.centre.y) - (connector.height + p.height) / 2,
  );

describe("gapCentre", () => {
  /**
   * The common case must not move: a binary relationship between two
   * same-sized entities has always sat at their midpoint, and re-laying every
   * existing diagram out differently would be a poor trade for a rule aimed at
   * the ternary case.
   */
  it("is the midpoint for two equal participants", () => {
    expect(
      gapCentre([participant(0, 0), participant(400, 0)], DIAMOND),
    ).toEqual({ x: 200, y: 0 });
  });

  /**
   * The search works hard for axis alignment and the ratchet measures it, so a
   * connector must never lose one to a rounding artefact.
   */
  it("keeps a coordinate every participant shares, exactly", () => {
    const centre = gapCentre(
      [participant(0, 300), participant(240, 300), participant(700, 300)],
      DIAMOND,
    );
    expect(centre.y).toBe(300);
  });

  it("keeps a shared coordinate even when the participants differ in size", () => {
    const centre = gapCentre(
      [participant(0, 120, 90, 44), participant(500, 120, 300, 200)],
      DIAMOND,
    );
    expect(centre.y).toBe(120);
  });

  /**
   * The point of the rule. A centroid balances the distances between centres;
   * with three participants that leaves the connector nearly touching the
   * middle one and a long way from the far one.
   */
  it("beats the centroid at its worst on a ternary", () => {
    const three = [
      participant(138, 0),
      participant(378, 0),
      participant(798, 0),
    ];
    const centroid = {
      x: (138 + 378 + 798) / 3,
      y: 0,
    };
    const balanced = gapCentre(three, DIAMOND);

    const worst = (v: { x: number; y: number }) =>
      Math.max(...three.map((p) => gapTo(v, p)));

    expect(worst(balanced)).toBeLessThan(worst(centroid));
    // and the two extreme participants end up equally far away
    expect(gapTo(balanced, three[0])).toBeCloseTo(gapTo(balanced, three[2]), 6);
  });

  it("balances gaps rather than centre distances when sizes differ", () => {
    const small = participant(0, 0, 90, 44);
    const large = participant(600, 0, 300, 44);
    const balanced = gapCentre([small, large], DIAMOND);

    expect(gapTo(balanced, small)).toBeCloseTo(gapTo(balanced, large), 6);
    // the centroid would sit at 300 and leave the wide one 105px closer
    expect(balanced.x).toBeLessThan(300);
  });

  it("returns the participant's own centre when there is only one", () => {
    expect(gapCentre([participant(70, 30)], DIAMOND)).toEqual({ x: 70, y: 30 });
  });
});

const box = (id: string, x: number, y: number, size = 100) => ({
  id,
  x: x - size / 2,
  y: y - size / 2,
  width: size,
  height: size,
});

const diamond = {
  id: "d",
  role: "connector" as const,
  type: "relationship",
  key: "d",
  width: 95,
  height: 95,
  visualWidth: 100,
  visualHeight: 100,
  haloRadius: 0,
  drawnHalo: 0,
  hidden: false,
  participants: [],
  groupKey: "",
  isSelfLoop: true,
  widestRoleLabel: 0,
  hierarchy: null,
};

describe("findFreeSpot", () => {
  it("takes the preferred point when it is clear", () => {
    expect(
      findFreeSpot(diamond, { x: 0, y: 0 }, [], DEFAULT_LAYOUT_PARAMS),
    ).toEqual({ x: 0, y: 0 });
  });

  /**
   * A caller that chose `preferred` for a reason can say which way it may be
   * pushed. The self-loop seat below is the case that needs it: displacing a
   * cardinal offset sideways makes it diagonal, which is the one thing that
   * placement was avoiding.
   */
  it("only looks along the directions it is given", () => {
    const step = DEFAULT_LAYOUT_PARAMS.gridStep;
    const spot = findFreeSpot(
      diamond,
      { x: 0, y: 0 },
      [box("blocker", 0, 0)],
      DEFAULT_LAYOUT_PARAMS,
      [{ x: 1, y: 0 }],
    );
    expect(spot!.y).toBe(0);
    expect(spot!.x).toBeGreaterThan(0);
    expect(spot!.x % step).toBe(0);
  });

  it("reports failure rather than handing back the blocked point", () => {
    // a wall right along the only ray it may use
    const wall = Array.from({ length: 40 }, (_, k) =>
      box("w" + k, k * DEFAULT_LAYOUT_PARAMS.gridStep, 0, 200),
    );
    expect(
      findFreeSpot(diamond, { x: 0, y: 0 }, wall, DEFAULT_LAYOUT_PARAMS, [
        { x: 1, y: 0 },
      ]),
    ).toBeNull();
  });
});

/**
 * A relationship that reaches one entity through several roles -- ERdoc's
 * `relation Manages(Department: [Management, Research 1!])` -- has that entity
 * as its whole centroid, so it is seated beside it instead. That seat has to
 * stay cardinal: useEdgePath picks the side an edge leaves by comparing |dx|
 * against |dy|, so a diagonal seat is a near-tie that flips sides under a pixel
 * of movement, and the two role edges stop having distinct handles.
 */
describe("a recursive relationship's seat", () => {
  it.each([
    ["roles", 0],
    ["company", 4],
  ])("is cardinal from its entity in %s", (_name, index) => {
    const { nodes, edges } = fromErDoc(EXAMPLES[index].erDoc);
    const { positions, sizes } = layoutDiscreteSearch(nodes, edges);
    const placed = withSizes(
      nodes.map((node) => ({ ...node, position: positions.get(node.id)! })),
      sizes,
    ) as unknown as PositionedNode[];
    const typeOf = (id: string) =>
      placed.find((node) => node.id === id)?.type ?? "";
    const centres = new Map(
      toAbsoluteRects(placed, { structuralOnly: false })
        .map((rect) =>
          visualRectOf(rect.id, typeOf(rect.id), rect, rect.width, rect.height),
        )
        .map((rect) => [
          rect.id,
          { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        ]),
    );

    const partners = new Map<string, Set<string>>();
    for (const edge of edges)
      for (const [a, b] of [
        [edge.source, edge.target],
        [edge.target, edge.source],
      ])
        if (typeOf(a) === "relationship" && typeOf(b) === "entity")
          partners.set(a, (partners.get(a) ?? new Set<string>()).add(b));

    const recursive = [...partners].filter(([, ents]) => ents.size === 1);
    expect(recursive.length).toBeGreaterThan(0);
    for (const [relationship, ents] of recursive) {
      const seat = centres.get(relationship)!;
      const owner = centres.get([...ents][0])!;
      expect(
        Math.round(seat.x - owner.x) === 0 ||
          Math.round(seat.y - owner.y) === 0,
      ).toBe(true);
    }
  });

  /**
   * The gap a recursive relationship leaves is the one gap in the diagram with
   * something drawn *inside* it: every one of its roles runs across it, with
   * its name on it, and both ends of every one of those lines is one of these
   * two shapes. At the ordinary minimum the names overlap the shapes.
   */
  it("is held further off than two unrelated elements would be", () => {
    const { nodes, edges } = fromErDoc(EXAMPLES[0].erDoc);
    const { positions, sizes } = layoutDiscreteSearch(nodes, edges);
    const placed = withSizes(
      nodes.map((node) => ({ ...node, position: positions.get(node.id)! })),
      sizes,
    ) as unknown as PositionedNode[];
    const typeOf = (id: string) =>
      placed.find((node) => node.id === id)?.type ?? "";
    const boxes = new Map(
      toAbsoluteRects(placed, { structuralOnly: false })
        .map((rect) =>
          visualRectOf(rect.id, typeOf(rect.id), rect, rect.width, rect.height),
        )
        .map((rect) => [rect.id, rect]),
    );

    const diamond = [...boxes.values()].find(
      (box) => typeOf(box.id) === "relationship",
    )!;
    const entity = [...boxes.values()].find(
      (box) => typeOf(box.id) === "entity",
    )!;

    // edge to edge, on whichever axis is keeping them apart
    const gap = Math.max(
      Math.abs(diamond.x + diamond.width / 2 - (entity.x + entity.width / 2)) -
        (diamond.width + entity.width) / 2,
      Math.abs(
        diamond.y + diamond.height / 2 - (entity.y + entity.height / 2),
      ) -
        (diamond.height + entity.height) / 2,
    );

    expect(gap).toBeGreaterThan(DEFAULT_LAYOUT_PARAMS.minSeparation);
    expect(gap).toBeCloseTo(DEFAULT_LAYOUT_PARAMS.selfLoopSeparation, 0);
  });

  /**
   * ...and once something has measured the names, from those rather than from
   * the fixed figure. A long role name would otherwise be drawn straight over
   * the shapes at either end of the gap it is written in.
   */
  it("is sized from the role names once they have been measured", () => {
    const seatFor = (labelWidth: number | undefined) => {
      const { nodes, edges } = fromErDoc(EXAMPLES[0].erDoc);
      const measured = edges.map((edge) =>
        /^[1-4]relationship-part/.test(edge.id)
          ? { ...edge, labelWidth }
          : edge,
      );
      const { positions, sizes } = layoutDiscreteSearch(nodes, measured);
      const placed = withSizes(
        nodes.map((node) => ({ ...node, position: positions.get(node.id)! })),
        sizes,
      ) as unknown as PositionedNode[];
      const typeOf = (id: string) =>
        placed.find((node) => node.id === id)?.type ?? "";
      const boxes = toAbsoluteRects(placed, { structuralOnly: false }).map(
        (rect) =>
          visualRectOf(rect.id, typeOf(rect.id), rect, rect.width, rect.height),
      );
      const diamond = boxes.find((box) => typeOf(box.id) === "relationship")!;
      const entity = boxes.find((box) => typeOf(box.id) === "entity")!;
      return Math.max(
        Math.abs(
          diamond.x + diamond.width / 2 - (entity.x + entity.width / 2),
        ) -
          (diamond.width + entity.width) / 2,
        Math.abs(
          diamond.y + diamond.height / 2 - (entity.y + entity.height / 2),
        ) -
          (diamond.height + entity.height) / 2,
      );
    };

    // room for the name itself, and a minimum's worth of margin at each end
    expect(seatFor(120)).toBeCloseTo(
      120 + 2 * DEFAULT_LAYOUT_PARAMS.minSeparation,
      0,
    );
    // ...and a name measured short asks for less than the blind fallback,
    // because by then there is nothing left to guess at
    expect(seatFor(10)).toBeCloseTo(
      10 + 2 * DEFAULT_LAYOUT_PARAMS.minSeparation,
      0,
    );
    // the fallback is for when nothing measured them at all
    expect(seatFor(undefined)).toBeCloseTo(
      DEFAULT_LAYOUT_PARAMS.selfLoopSeparation,
      0,
    );
  });

  /**
   * ...but it takes that room out of its own entity's, never out of somebody
   * else's. Seated past another element on the axis it is pushed along, the
   * diamond has left its entity's column, and it stops being obvious which
   * entity it hangs off -- which is the one thing its position is there to say.
   *
   * It is also what keeps the seat steady: the distance is absolute while
   * everything around it is spaced for the current view, so a diamond allowed
   * to overtake does it only in the tighter view, and hiding the attributes
   * would reorder the diagram (attributeBlind.test.ts).
   */
  it.each([
    ["roles", 0],
    ["company", 4],
  ])("does not overtake its entity's neighbours in %s", (_name, index) => {
    const { nodes, edges } = fromErDoc(EXAMPLES[index].erDoc);
    const { positions, sizes } = layoutDiscreteSearch(nodes, edges);
    const placed = withSizes(
      nodes.map((node) => ({ ...node, position: positions.get(node.id)! })),
      sizes,
    ) as unknown as PositionedNode[];
    const typeOf = (id: string) =>
      placed.find((node) => node.id === id)?.type ?? "";
    const centres = new Map(
      toAbsoluteRects(placed, { structuralOnly: false })
        .map((rect) =>
          visualRectOf(rect.id, typeOf(rect.id), rect, rect.width, rect.height),
        )
        .map((rect) => [
          rect.id,
          { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
        ]),
    );

    const partners = new Map<string, Set<string>>();
    for (const edge of edges)
      for (const [a, b] of [
        [edge.source, edge.target],
        [edge.target, edge.source],
      ])
        if (typeOf(a) === "relationship" && typeOf(b) === "entity")
          partners.set(a, (partners.get(a) ?? new Set<string>()).add(b));

    const entities = [...centres].filter(([id]) => typeOf(id) === "entity");

    for (const [relationship, ents] of partners) {
      if (ents.size !== 1) continue;
      const ownerId = [...ents][0];
      const seat = centres.get(relationship)!;
      const owner = centres.get(ownerId)!;

      const axis = Math.round(seat.y - owner.y) === 0 ? "x" : "y";
      const sign = Math.sign(seat[axis] - owner[axis]);
      const reach = (seat[axis] - owner[axis]) * sign;

      for (const [id, centre] of entities) {
        if (id === ownerId) continue;
        const ahead = (centre[axis] - owner[axis]) * sign;
        expect(ahead > 0 && ahead < reach).toBe(false);
      }
    }
  });
});
