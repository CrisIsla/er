/**
 * The spacing pass: widening the gaps between the rows and columns an
 * arrangement produced, without letting the arrangement itself change.
 *
 * Two things are being checked here, and only one of them is arithmetic. The
 * other is the property the whole design rests on -- that no element can change
 * places, lose an alignment or leave the grid, whatever the gaps do.
 */

import { buildLayoutGraph } from "../../../../src/app/util/layout/buildLayoutGraph";
import { isOnGrid } from "../../../../src/app/util/layout/geometry";
import { DEFAULT_LAYOUT_PARAMS } from "../../../../src/app/util/layout/params";
import {
  AxisSpacing,
  IDENTITY_SPACING,
  applySpacing,
  remap,
  remapFootprint,
  spacingFor,
} from "../../../../src/app/util/layout/spacing";
import { LayoutGraph, Placement } from "../../../../src/app/util/layout/types";
import { fromErDoc } from "./fixtures";

const params = DEFAULT_LAYOUT_PARAMS;

const graphOf = (source: string) => {
  const { nodes, edges } = fromErDoc(source);
  return buildLayoutGraph(nodes, edges, params);
};

/**
 * The skeleton element for an ERdoc name. Keys read `entity: Alpha` and
 * `relationship: Joins$Alpha$Beta`, so a relationship is found by its own name
 * rather than by the participants appended to it.
 */
const idOf = (graph: LayoutGraph, name: string) => {
  const element = graph.skeleton.find((item) => {
    const label = item.key.slice(item.key.indexOf(": ") + 2);
    return label === name || label.startsWith(`${name}$`);
  });
  if (element === undefined) throw new Error(`no skeleton element for ${name}`);
  return element.id;
};

describe("remap", () => {
  it("leaves a coordinate alone when there are no lines", () => {
    expect(remap({ from: [], to: [] }, 137)).toBe(137);
  });

  it("lands a line exactly where the map says", () => {
    const map: AxisSpacing = { from: [0, 60, 120], to: [0, 120, 240] };
    expect(remap(map, 0)).toBe(0);
    expect(remap(map, 60)).toBe(120);
    expect(remap(map, 120)).toBe(240);
  });

  it("gives anything between two lines its share of the new gap", () => {
    const map: AxisSpacing = { from: [0, 60], to: [0, 120] };
    expect(remap(map, 30)).toBe(60);
    expect(remap(map, 45)).toBe(90);
  });

  /**
   * Not a rounding nicety: a triangle seated between two rows that did not move
   * would otherwise come back from a division and a multiplication a fraction of
   * a pixel from where it started, and every "is this still aligned" test in the
   * layout is an exact comparison.
   */
  it("returns a value between two unmoved lines untouched", () => {
    const map: AxisSpacing = { from: [0, 60, 120], to: [0, 60, 180] };
    expect(remap(map, 17)).toBe(17);
  });

  it("translates anything outside the lines by what the nearest one did", () => {
    const map: AxisSpacing = { from: [0, 60], to: [30, 150] };
    expect(remap(map, -40)).toBe(-10);
    expect(remap(map, 100)).toBe(190);
  });

  it("never lets one coordinate overtake another", () => {
    const map: AxisSpacing = { from: [0, 60, 300], to: [0, 180, 480] };
    const values = [-90, 0, 17, 60, 61, 200, 300, 400];
    const mapped = values.map((value) => remap(map, value));
    expect(mapped).toEqual([...mapped].sort((a, b) => a - b));
  });
});

describe("applySpacing", () => {
  const centres: Placement = new Map([
    ["a", { x: 0, y: 0 }],
    ["b", { x: 60, y: 60 }],
  ]);

  it("maps every centre it is given", () => {
    const spaced = applySpacing(
      {
        x: { from: [0, 60], to: [0, 120] },
        y: { from: [0, 60], to: [0, 120] },
      },
      centres,
    );
    expect([...spaced]).toEqual([
      ["a", { x: 0, y: 0 }],
      ["b", { x: 120, y: 120 }],
    ]);
  });

  it("keeps the order of the map, which the determinism tests compare", () => {
    expect([...applySpacing(IDENTITY_SPACING, centres).keys()]).toEqual([
      "a",
      "b",
    ]);
  });
});

describe("remapFootprint", () => {
  const footprint = { dx: 0, dy: 90, width: 240, height: 300 };

  it("leaves a footprint alone under the identity", () => {
    expect(
      remapFootprint(
        IDENTITY_SPACING,
        footprint,
        { x: 0, y: 0 },
        { x: 0, y: 0 },
      ),
    ).toEqual(footprint);
  });

  it("grows the box by however much the rows under it opened", () => {
    // the root sits on y=0, the tree reaches from -60 to 240; doubling that
    // stretch has to leave the box twice as tall and still hanging off the root
    const spacing = {
      x: { from: [], to: [] },
      y: { from: [-60, 240], to: [-60, 540] },
    };
    const moved = remapFootprint(
      spacing,
      footprint,
      { x: 0, y: 0 },
      { x: 0, y: 0 },
    );
    expect(moved.height).toBe(600);
    expect(moved.width).toBe(240);
    expect(moved.dy).toBe(240);
  });
});

describe("spacingFor", () => {
  const twoEntities = `
    entity Alpha {
      id key
      one
      two
    }
    entity Beta {
      id key
      three
    }
  `;

  it("is the identity when the pass is switched off", () => {
    const graph = graphOf(twoEntities);
    const centres: Placement = new Map([
      [idOf(graph, "Alpha"), { x: 0, y: 0 }],
      [idOf(graph, "Beta"), { x: 60, y: 0 }],
    ]);
    expect(
      spacingFor(graph, centres, {
        ...params,
        spacing: { enabled: false },
      }),
    ).toBe(IDENTITY_SPACING);
  });

  it("is the identity when nothing needs more room than it has", () => {
    const graph = graphOf(twoEntities);
    const centres: Placement = new Map([
      [idOf(graph, "Alpha"), { x: 0, y: 0 }],
      [idOf(graph, "Beta"), { x: 600, y: 0 }],
    ]);
    expect(spacingFor(graph, centres, params)).toBe(IDENTITY_SPACING);
  });

  it("opens a column until two rings on the same row fit between them", () => {
    const graph = graphOf(twoEntities);
    const alpha = idOf(graph, "Alpha");
    const beta = idOf(graph, "Beta");
    const centres: Placement = new Map([
      [alpha, { x: 0, y: 0 }],
      [beta, { x: 60, y: 0 }],
    ]);

    const spaced = applySpacing(spacingFor(graph, centres, params), centres);
    const gap = spaced.get(beta)!.x - spaced.get(alpha)!.x;

    const ring = (id: string) =>
      graph.elements.get(id)!.haloRadius * params.haloFactor;
    const half = (id: string) => graph.elements.get(id)!.visualWidth / 2;
    expect(gap).toBeGreaterThanOrEqual(
      half(alpha) +
        half(beta) +
        ring(alpha) +
        ring(beta) +
        params.minSeparation,
    );
  });

  it("widens by whole grid steps, so nothing leaves the lattice", () => {
    const graph = graphOf(twoEntities);
    const centres: Placement = new Map([
      [idOf(graph, "Alpha"), { x: 0, y: 0 }],
      [idOf(graph, "Beta"), { x: 60, y: 0 }],
    ]);
    for (const centre of applySpacing(
      spacingFor(graph, centres, params),
      centres,
    ).values()) {
      expect(isOnGrid(centre.x, params.gridStep)).toBe(true);
      expect(isOnGrid(centre.y, params.gridStep)).toBe(true);
    }
  });

  it("leaves a row clear that only a diagonal neighbour is crowding", () => {
    // Alpha and Beta are a step apart on both axes, so neither axis alone has to
    // hold their rings: they are already past each other.
    const graph = graphOf(twoEntities);
    const centres: Placement = new Map([
      [idOf(graph, "Alpha"), { x: 0, y: 0 }],
      [idOf(graph, "Beta"), { x: 120, y: 120 }],
    ]);
    expect(spacingFor(graph, centres, params)).toBe(IDENTITY_SPACING);
  });

  /**
   * The one exception to reserving the ring. Attributes are fanned into the
   * angular sectors an owner's edges leave free, so the direction a line leaves
   * in is the one direction the ring is never in -- and demanding room for it
   * between two things that are wired together reserves space for something
   * nobody draws.
   */
  it("does not reserve a ring between an element and something it joins", () => {
    const graph = graphOf(`
      entity Alpha {
        id key
        one
        two
      }
      entity Beta { id key }
      relation Joins(Alpha, Beta)
    `);
    const alpha = idOf(graph, "Alpha");
    const diamond = idOf(graph, "Joins");
    const between = (centres: Placement) =>
      spacingFor(graph, centres, params) === IDENTITY_SPACING;

    // just enough for the two boxes and the minimum gap, and no more
    const tight =
      (graph.elements.get(alpha)!.visualHeight +
        graph.elements.get(diamond)!.visualHeight) /
        2 +
      params.minSeparation;
    const seat = Math.ceil(tight / params.gridStep) * params.gridStep;

    expect(
      between(
        new Map([
          [alpha, { x: 0, y: 0 }],
          [diamond, { x: 0, y: seat }],
        ]),
      ),
    ).toBe(true);

    // ...whereas an element it is *not* joined to, at the same distance, is
    // pushed away to make room for the ring
    const stranger = idOf(graph, "Beta");
    expect(
      between(
        new Map([
          [alpha, { x: 0, y: 0 }],
          [stranger, { x: 0, y: seat }],
        ]),
      ),
    ).toBe(false);
  });

  it("moves everything on a line by the same amount", () => {
    const graph = graphOf(`
      entity Alpha {
        id key
        one
        two
      }
      entity Beta {
        id key
        three
      }
      entity Gamma { id key }
    `);
    const alpha = idOf(graph, "Alpha");
    const beta = idOf(graph, "Beta");
    const gamma = idOf(graph, "Gamma");
    // Beta and Gamma share a column, and Alpha is crowding Beta on the row
    const centres: Placement = new Map([
      [alpha, { x: 0, y: 0 }],
      [beta, { x: 60, y: 0 }],
      [gamma, { x: 60, y: 600 }],
    ]);

    const spaced = applySpacing(spacingFor(graph, centres, params), centres);
    expect(spaced.get(beta)!.x).toBe(spaced.get(gamma)!.x);
    expect(spaced.get(beta)!.x).toBeGreaterThan(60);
  });

  it("keeps every element in the order the arrangement put it in", () => {
    const graph = graphOf(`
      entity Alpha {
        id key
        one
        two
      }
      entity Beta {
        id key
        three
      }
      entity Gamma {
        id key
        four
      }
    `);
    const ids = ["Alpha", "Beta", "Gamma"].map((name) => idOf(graph, name));
    const centres: Placement = new Map(
      ids.map((id, index) => [id, { x: index * 60, y: 0 }]),
    );

    const spaced = applySpacing(spacingFor(graph, centres, params), centres);
    const xs = ids.map((id) => spaced.get(id)!.x);
    expect(xs).toEqual([...xs].sort((a, b) => a - b));
    expect(new Set(xs).size).toBe(3);
  });
});
