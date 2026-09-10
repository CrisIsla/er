/**
 * What the arrangement is allowed to know about the attributes, and what
 * follows from the answer.
 *
 * The complaint this settles: with the attributes in view the search decides
 * *where* things go partly from how much room their rings need, so adding a
 * field to one entity reorders the others, and hiding the attributes reorders
 * them again -- though no entity and no relationship moved. Two people reading
 * the same model with different attribute settings see two different diagrams.
 *
 * `arrangement.attributeBlind` takes the rings and the attribute counts away
 * from the arranging stage and leaves the room to the spacing pass, which runs
 * afterwards and is allowed to depend on the view. The arrangement becomes a
 * property of the model; the spacing stays a property of what is on screen.
 *
 * These are the properties that buys, stated as tests. They fail without it --
 * that is the point of the flag, not an accident of the corpus.
 */

import { isAttributeNode } from "../../../../src/app/util/erGraph";
import { layoutDiscreteSearch } from "../../../../src/app/util/layout";
import { LayoutInputNode } from "../../../../src/app/util/layout/buildLayoutGraph";
import {
  DEFAULT_LAYOUT_PARAMS,
  LayoutParams,
} from "../../../../src/app/util/layout/params";
import { EXAMPLES, fromErDoc } from "./fixtures";

const STRUCTURAL = ["entity", "relationship", "isA", "aggregation"];

const BLIND: LayoutParams = {
  ...DEFAULT_LAYOUT_PARAMS,
  arrangement: { ...DEFAULT_LAYOUT_PARAMS.arrangement, attributeBlind: true },
};

/**
 * An aggregation's box is cut to fit the contents the layout just arranged, and
 * `memberRects` counts only the ones that are drawn -- so hiding the attributes
 * inside a container shrinks the container itself, which is a real change of
 * size that everything around it then has to be arranged for.
 *
 * Neither setting below reaches that. The box is not a ring the spacing pass can
 * open and close; it is a shape the diagram draws, and its size is also the
 * floor a manual resize is held to. The two examples with a container are
 * therefore held out of these tests, and closing that last gap is the next piece
 * of this work rather than a defect of this one.
 */
const withoutAggregations = EXAMPLES.filter(
  ({ erDoc }) =>
    !fromErDoc(erDoc).nodes.some((node) => node.type === "aggregation"),
);

const hideAttributes = (nodes: LayoutInputNode[]) =>
  nodes.map((node) =>
    isAttributeNode(node) ? { ...node, hidden: true } : node,
  );

/** Gives the first entity in the source ten more fields. */
const withMoreFields = (erDoc: string) =>
  erDoc.replace(
    /entity\s+\w+[^{]*\{/,
    (declaration) =>
      `${declaration}\n  ${[
        "z1",
        "z2",
        "z3",
        "z4",
        "z5",
        "z6",
        "z7",
        "z8",
        "z9",
        "z10",
      ].join("\n  ")}`,
  );

/** Structural centres, keyed by the ERdoc identity rather than the array index. */
const skeletonCentres = (
  nodes: LayoutInputNode[],
  positions: Map<string, { x: number; y: number }>,
) => {
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const centres = new Map<string, { x: number; y: number }>();
  for (const node of nodes) {
    if (!STRUCTURAL.includes(node.type ?? "")) continue;
    // an aggregation's members are positioned in their container's own frame
    if (node.parentNode && byId.get(node.parentNode)?.type === "aggregation")
      continue;
    const position = positions.get(node.id);
    if (position === undefined) continue;
    centres.set(String(node.data?.erId ?? node.id), {
      x: position.x + (node.width ?? 0) / 2,
      y: position.y + (node.height ?? 0) / 2,
    });
  }
  return centres;
};

/**
 * Every pair of elements the two layouts put in a different order, on either
 * axis. Not a distance: two arrangements that agree on what is left of what and
 * what is above what are the same arrangement drawn at two spacings, which is
 * the whole point.
 *
 * Compared to the nearest pixel, because the diagram is shifted into the
 * positive quadrant by a margin measured off the attribute ring, and that
 * arithmetic lands a hair apart between two views that are otherwise identical.
 */
const disagreements = (
  a: Map<string, { x: number; y: number }>,
  b: Map<string, { x: number; y: number }>,
) => {
  const ids = [...a.keys()].filter((id) => b.has(id)).sort();
  const order = (
    map: Map<string, { x: number; y: number }>,
    first: string,
    second: string,
    axis: "x" | "y",
  ) => Math.sign(Math.round(map.get(first)![axis] - map.get(second)![axis]));

  const differing: string[] = [];
  for (let i = 0; i < ids.length; i++)
    for (let j = i + 1; j < ids.length; j++)
      for (const axis of ["x", "y"] as const)
        if (order(a, ids[i], ids[j], axis) !== order(b, ids[i], ids[j], axis))
          differing.push(`${ids[i]} ${axis} ${ids[j]}`);
  return differing;
};

/** How far the arrangement reaches on each axis, wherever it happens to sit. */
const extent = (centres: Map<string, { x: number; y: number }>) => {
  const on = (axis: "x" | "y") => [...centres.values()].map((c) => c[axis]);
  return {
    x: Math.max(...on("x")) - Math.min(...on("x")),
    y: Math.max(...on("y")) - Math.min(...on("y")),
  };
};

const layoutOf = (
  nodes: LayoutInputNode[],
  edges: never[],
  params: LayoutParams,
) =>
  skeletonCentres(nodes, layoutDiscreteSearch(nodes, edges, params).positions);

describe.each(withoutAggregations)("$name, arranged blind", ({ erDoc }) => {
  const shown = fromErDoc(erDoc);
  const grown = fromErDoc(withMoreFields(erDoc));

  const asShown = layoutOf(shown.nodes, shown.edges as never[], BLIND);
  const asHidden = layoutOf(
    hideAttributes(shown.nodes),
    shown.edges as never[],
    BLIND,
  );

  it("puts everything in the same order whether the attributes show or not", () => {
    expect(disagreements(asShown, asHidden)).toEqual([]);
  });

  it("draws the hidden view no larger than the shown one", () => {
    // the other half of the same claim: the arrangement is fixed, the spacing is
    // not. Measured across the elements rather than from the origin, because the
    // margin the diagram is shifted by is itself read off the attribute rings.
    expect(Math.round(extent(asHidden).x)).toBeLessThanOrEqual(
      Math.round(extent(asShown).x),
    );
    expect(Math.round(extent(asHidden).y)).toBeLessThanOrEqual(
      Math.round(extent(asShown).y),
    );
  });

  it("does not reorder the diagram when an entity gains ten fields", () => {
    expect(
      disagreements(
        asShown,
        layoutOf(grown.nodes, grown.edges as never[], BLIND),
      ),
    ).toEqual([]);
  });

  it("...nor when it gains them with the attributes hidden", () => {
    expect(
      disagreements(
        asHidden,
        layoutOf(hideAttributes(grown.nodes), grown.edges as never[], BLIND),
      ),
    ).toEqual([]);
  });
});

/**
 * The setting the user actually sees, which is a different question: not what
 * the arrangement knows, but whether hiding the attributes is allowed to close
 * the gaps that were left for them.
 *
 * Either way it is the *same arrangement*. Both readings of the ring are taken
 * from the model, not the view -- what the arranging stage sets aside counts
 * every attribute an element owns, and only what the spacing pass makes room for
 * follows what is drawn. Wiring the setting any higher up than that is what made
 * hiding the attributes produce a different diagram rather than the same one
 * tighter.
 */
describe.each(withoutAggregations)(
  "$name, with the gaps closed",
  ({ erDoc }) => {
    const { nodes, edges } = fromErDoc(erDoc);
    const shown = layoutOf(nodes, edges as never[], DEFAULT_LAYOUT_PARAMS);
    const hidden = layoutOf(
      hideAttributes(nodes),
      edges as never[],
      DEFAULT_LAYOUT_PARAMS,
    );

    it("keeps every element in the order the shown view put it in", () => {
      expect(disagreements(shown, hidden)).toEqual([]);
    });

    it("draws it no larger than the shown view", () => {
      expect(Math.round(extent(hidden).x)).toBeLessThanOrEqual(
        Math.round(extent(shown).x),
      );
      expect(Math.round(extent(hidden).y)).toBeLessThanOrEqual(
        Math.round(extent(shown).y),
      );
    });
  },
);

/**
 * ...and the other setting: every gap held at the size the shown view uses, so
 * the attributes appear and disappear without anything else moving at all.
 */
describe.each(withoutAggregations)(
  "$name, with the gaps held open",
  ({ erDoc }) => {
    const held: LayoutParams = {
      ...DEFAULT_LAYOUT_PARAMS,
      spacing: { ...DEFAULT_LAYOUT_PARAMS.spacing, closeHiddenGaps: false },
    };
    const { nodes, edges } = fromErDoc(erDoc);

    it("leaves every element exactly where the shown view puts it", () => {
      const shown = layoutOf(nodes, edges as never[], held);
      const hidden = layoutOf(hideAttributes(nodes), edges as never[], held);
      // relative to one another, not to the origin: the whole diagram is shifted
      // into the positive quadrant by a margin measured off what is drawn, and
      // with the rings gone there is less of that to measure
      const [anchor] = [...shown.keys()].sort();
      const offset = {
        x: hidden.get(anchor)!.x - shown.get(anchor)!.x,
        y: hidden.get(anchor)!.y - shown.get(anchor)!.y,
      };
      for (const [id, centre] of shown) {
        expect(hidden.get(id)!.x - offset.x).toBeCloseTo(centre.x, 6);
        expect(hidden.get(id)!.y - offset.y).toBeCloseTo(centre.y, 6);
      }
      expect(shown.size).toBeGreaterThan(0);
    });
  },
);
