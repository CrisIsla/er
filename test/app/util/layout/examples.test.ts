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
import { isAttributeNode } from "../../../../src/app/util/erGraph";
import { layoutDiscreteSearch } from "../../../../src/app/util/layout";
import { minimumAggregationSize } from "../../../../src/app/util/layout/aggregationBox";
import {
  rectsOverlap,
  visualRectOf,
} from "../../../../src/app/util/layout/geometry";
import { nearestAttributeApproach } from "../../../../src/app/util/layout/metrics";
import { DEFAULT_LAYOUT_PARAMS } from "../../../../src/app/util/layout/params";
import { EXAMPLES, fromErDoc, withSizes } from "./fixtures";

const STRUCTURAL = ["entity", "relationship", "isA", "aggregation"];

/**
 * Attribute collisions each example currently ships with, as a ratchet.
 *
 * Nothing in the layout stops these: attributes are placed last, into whichever
 * angular sector around their owner is free, with no rectangle test against
 * anything else. Recorded per example so the number can only go down.
 */
const ATTRIBUTE_COLLISIONS: Record<string, number> = {
  roles: 0,
  aggregation: 0,
  subclass: 0,
  bank: 0,
  // Department|d_name lands on Employee itself; Project|p_name lands on both the
  // Supplies diamond and Supplies' own Quantity
  company: 7,
};

/**
 * How near an attribute currently comes to a structural line that is not its
 * own, per example, as a floor it may not fall below.
 *
 * Numbers to raise, not thresholds that have been met: `attributeGap / 2` would
 * be the honest floor, and `company` and `bank` are both under it.
 */
const ATTRIBUTE_CLEARANCE: Record<string, number> = {
  roles: 0,
  aggregation: 62,
  subclass: 173,
  bank: 12,
  company: 21,
};

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

  /**
   * The test above only ever compares an attribute with its own React Flow
   * parent, so an attribute sitting on a *different* element passes it. That is
   * the whole of the attribute pass's blind spot: placeAttributes fans into free
   * angular sectors around one owner and performs no rectangle test of any kind,
   * so nothing but this stops a ring from being drawn over the diagram.
   */
  it("does not fan an attribute further over the diagram than it already does", () => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const rects = laidOutRects(sized, positions);
    const byRect = new Map(rects.map((rect) => [rect.id, rect]));
    const owners = new Map(nodes.map((node) => [node.id, node.parentNode]));

    const overlapping = new Set<string>();
    for (const node of nodes) {
      if (!isAttributeNode(node) || node.hidden) continue;
      const mine = byRect.get(node.id);
      if (mine === undefined) continue;
      for (const other of rects) {
        if (other.id === node.id) continue;
        // its own owner, and any attribute composed out of it, are allowed
        if (other.id === owners.get(node.id)) continue;
        if (owners.get(other.id) === node.id) continue;
        const otherNode = byId.get(other.id);
        // an aggregation container legitimately encloses whatever is inside it
        if (otherNode?.type === "aggregation") continue;
        if (rectsOverlap(mine, other))
          overlapping.add(
            [node.data?.erId, otherNode?.data?.erId].sort().join(" / "),
          );
      }
    }

    // A ratchet, not a clean bill of health. `placeAttributes` fans into free
    // angular sectors around one owner and performs no rectangle test of any
    // kind -- it cannot see a sibling entity, a diamond it is not attached to,
    // or another element's attributes -- so the corpus starts with real
    // collisions. Recorded so they cannot grow while the layout is worked on;
    // lower the number when a change removes some.
    expect(overlapping.size).toBeLessThanOrEqual(ATTRIBUTE_COLLISIONS[name]);
  });

  /**
   * The rectangle tests cannot see this one. An attribute is an ellipse hung off
   * its owner and a relationship edge is a thin line: the two cross without
   * either box overlapping anything, and the attribute then reads as belonging
   * to whatever that line joins. `bank` currently draws
   * `premium_customer|discount` exactly on top of one.
   */
  it("does not move an attribute nearer a line it does not belong to", () => {
    const byId = new Map(nodes.map((node) => [node.id, node]));
    const typeOf = (id: string) => byId.get(id)?.type ?? "";
    const centres = new Map(
      laidOutRects(sized, positions).map((rect) => [
        rect.id,
        { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
      ]),
    );

    const attributes = nodes
      .filter((node) => isAttributeNode(node) && !node.hidden)
      .map((node) => ({
        id: String(node.data?.erId ?? node.id),
        centre: centres.get(node.id)!,
        ownerId: node.parentNode ?? node.id,
      }));
    const drawn = edges
      .filter(
        (edge) =>
          STRUCTURAL.includes(typeOf(edge.source)) &&
          STRUCTURAL.includes(typeOf(edge.target)),
      )
      .map((edge) => ({
        a: centres.get(edge.source)!,
        b: centres.get(edge.target)!,
        from: edge.source,
        to: edge.target,
      }));

    const { nearest } = nearestAttributeApproach(attributes, drawn);
    expect(nearest).toBeGreaterThanOrEqual(ATTRIBUTE_CLEARANCE[name]);
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
