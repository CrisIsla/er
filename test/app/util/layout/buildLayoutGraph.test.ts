import { buildLayoutGraph } from "../../../../src/app/util/layout/buildLayoutGraph";
import { DEFAULT_LAYOUT_PARAMS } from "../../../../src/app/util/layout/params";
import { layoutDiscreteSearch } from "../../../../src/app/util/layout";
import { LayoutGraph } from "../../../../src/app/util/layout/types";
import { COMPOSITE_ERDOC, fromErDoc } from "./fixtures";
import aggregation from "../../../../src/app/static/examples/aggregation.json";
import bank from "../../../../src/app/static/examples/bank.json";
import company from "../../../../src/app/static/examples/company.json";
import roles from "../../../../src/app/static/examples/roles.json";
import subclass from "../../../../src/app/static/examples/subclass.json";

const build = (source: string) => {
  const { nodes, edges } = fromErDoc(source);
  return {
    graph: buildLayoutGraph(nodes, edges, DEFAULT_LAYOUT_PARAMS),
    nodes,
  };
};

const labelOf = (graph: ReturnType<typeof build>["graph"], id: string) =>
  graph.elements.get(id)?.key;

describe("roles: a single entity with a recursive relationship", () => {
  const { graph, nodes } = build(roles.erDoc);

  it("finds exactly one skeleton element", () => {
    expect(graph.skeleton).toHaveLength(1);
    expect(graph.skeleton[0].key).toBe("entity: Employee");
  });

  it("marks the recursive relationship as a self loop", () => {
    expect(graph.connectors).toHaveLength(1);
    const [manages] = graph.connectors;
    expect(manages.isSelfLoop).toBe(true);
    expect(manages.participants).toHaveLength(1);
    expect(labelOf(graph, manages.participants[0])).toBe("entity: Employee");
  });

  it("leaves the lone entity without neighbours, so placement must not rely on anchors", () => {
    expect(graph.neighbours.get(graph.skeleton[0].id)).toEqual([]);
  });

  it("covers every input node exactly once", () => {
    expect(graph.elements.size).toBe(nodes.length);
  });
});

describe("bank: an aggregation used as a relationship participant", () => {
  const { graph } = build(bank.erDoc);

  it("treats the aggregation container as a skeleton element", () => {
    const keys = graph.skeleton.map((element) => element.key);
    expect(keys).toContain("entity: Bank_With_Branches");
  });

  it("freezes the nodes inside the aggregation", () => {
    const frozenKeys = graph.frozen.map((element) => element.key);
    expect(frozenKeys).toContain("entity: bank");
    expect(frozenKeys).toContain("entity: bank_branch");
    // the aggregated relationship itself is inside the box too
    expect(
      frozenKeys.some((key) => key.startsWith("relationship: has_branches")),
    ).toBe(true);
  });

  it("keeps both endpoints of a relationship that reaches the aggregation", () => {
    // the diamond is placed by the search, so what it joins is its adjacency
    const accts = graph.skeleton.find((element) =>
      element.key.startsWith("relationship: accts"),
    )!;
    const keys = graph.neighbours
      .get(accts.id)!
      .map((id) => labelOf(graph, id));
    expect(keys).toHaveLength(2);
    expect(keys).toContain("entity: Bank_With_Branches");
    expect(keys).toContain("entity: account");
  });

  it("does not give the frozen entities a halo, since they are not placed", () => {
    const insideBank = graph.frozen.find(
      (element) => element.key === "entity: bank",
    )!;
    expect(insideBank.haloRadius).toBe(0);
  });
});

describe("subclass: a pure ISA hierarchy", () => {
  const { graph } = build(subclass.erDoc);

  it("makes one triangle per subclass, each with a direction", () => {
    expect(graph.connectors).toHaveLength(8);
    for (const connector of graph.connectors) {
      expect(connector.type).toBe("isA");
      expect(connector.hierarchy).not.toBeNull();
      expect(connector.participants).toHaveLength(2);
    }
  });

  it("points the hierarchy from superclass to subclass", () => {
    const managementEmployee = graph.connectors.find(
      (connector) =>
        connector.key === "isA: entity: Management_Employee|entity: Employee",
    )!;
    expect(labelOf(graph, managementEmployee.hierarchy!.parentId)).toBe(
      "entity: Employee",
    );
    expect(labelOf(graph, managementEmployee.hierarchy!.childId)).toBe(
      "entity: Management_Employee",
    );
  });

  it("counts ISA links in the weight, so the hub is the heaviest element", () => {
    const employee = graph.skeleton.find(
      (element) => element.key === "entity: Employee",
    )!;
    // 3 attributes + 3 subclasses
    expect(employee.weight).toBe(6);
    const heaviest = [...graph.skeleton].sort((a, b) => b.weight - a.weight)[0];
    expect(heaviest.key).toBe("entity: Employee");
  });

  it("links a superclass to its subclasses as neighbours", () => {
    const employee = graph.skeleton.find(
      (element) => element.key === "entity: Employee",
    )!;
    const neighbourKeys = graph.neighbours
      .get(employee.id)!
      .map((id) => labelOf(graph, id));
    expect(neighbourKeys).toEqual(
      expect.arrayContaining([
        "entity: Management_Employee",
        "entity: Engineer",
        "entity: Secretary",
      ]),
    );
  });
});

describe("company: n-ary and recursive relationships side by side", () => {
  const { graph } = build(company.erDoc);

  it("keeps all three participants of a ternary relationship", () => {
    const supplies = graph.skeleton.find((element) =>
      element.key.startsWith("relationship: Supplies"),
    )!;
    // three spokes, and -- unlike the clique it used to contract to -- no
    // adjacency invented between the three entities themselves
    expect(graph.neighbours.get(supplies.id)).toHaveLength(3);
    for (const participant of graph.neighbours.get(supplies.id)!)
      expect(graph.neighbours.get(participant)).toContain(supplies.id);
  });

  it("detects the recursive Manages relationship", () => {
    const manages = graph.connectors.find((connector) =>
      connector.key.startsWith("relationship: Manages"),
    )!;
    expect(manages.isSelfLoop).toBe(true);
  });

  it("gives connectors joining the same elements the same group key", () => {
    const byGroup = new Map<string, number>();
    for (const connector of graph.connectors)
      byGroup.set(
        connector.groupKey,
        (byGroup.get(connector.groupKey) ?? 0) + 1,
      );
    // Works_for and Manages both touch Department, but Manages is a self loop,
    // so no two connectors here share a group
    expect([...byGroup.values()].every((count) => count >= 1)).toBe(true);
  });
});

describe("aggregation example", () => {
  const { graph } = build(aggregation.erDoc);

  it("reserves the container's own 500x500 box", () => {
    const container = graph.skeleton.find(
      (element) => element.key === "entity: Book_written_by_Author",
    )!;
    expect(container.width).toBe(500);
    expect(container.height).toBe(500);
  });
});

describe("attributes", () => {
  it("resolves composite children back to the entity that owns them", () => {
    const { graph } = build(COMPOSITE_ERDOC);
    const street = graph.satellites.find((element) =>
      element.key.endsWith("|address|street"),
    )!;
    expect(labelOf(graph, street.ownerId)).toBe("entity: Person");
    expect(labelOf(graph, street.parentAttributeId!)).toBe(
      "entity-attr: Person|address",
    );
  });

  it("reserves a wider halo when an entity has composite attributes", () => {
    const { graph } = build(COMPOSITE_ERDOC);
    const person = graph.skeleton[0];
    const flat = build(`entity Person { id key }`).graph.skeleton[0];
    expect(person.haloRadius).toBeGreaterThan(flat.haloRadius);
  });

  it("gives an entity with no attributes no halo at all", () => {
    const { graph } = build(`
      entity A { id key }
      entity B extends A {}
    `);
    const b = graph.skeleton.find((element) => element.key === "entity: B")!;
    expect(b.haloRadius).toBe(0);
  });
});

describe("visual sizes", () => {
  it("expands the diamond to the box it really covers", () => {
    const { graph } = build(roles.erDoc);
    const [manages] = graph.connectors;
    expect(manages.width).toBe(95);
    expect(manages.visualWidth).toBeCloseTo(95 * Math.SQRT2, 5);
  });
});

describe("hidden attributes", () => {
  const source = `
    entity Person {
      id key
      name
      email
    }
    entity Pet { tag key }
    relation Owns(Person, Pet)
  `;

  const hideAttributes = (nodes: ReturnType<typeof fromErDoc>["nodes"]) =>
    nodes.map((node) =>
      [
        "entity-attribute",
        "relationship-attribute",
        "composite-attribute",
      ].includes(node.type ?? "")
        ? { ...node, hidden: true }
        : node,
    );

  const personIn = (graph: LayoutGraph) =>
    graph.skeleton.find((element) => element.key === "entity: Person")!;

  const bothWays = (params = DEFAULT_LAYOUT_PARAMS) => {
    const { nodes, edges } = fromErDoc(source);
    return {
      shown: personIn(buildLayoutGraph(nodes, edges, params)),
      hidden: personIn(buildLayoutGraph(hideAttributes(nodes), edges, params)),
    };
  };

  /**
   * The two halo readings, and why there are two.
   *
   * `haloRadius` is what the *arranging* stage sets aside, and hiding an
   * attribute must not change it. That number decides how far out a candidate
   * position starts and how close two elements may be accepted, so letting the
   * view move it would mean toggling the attributes off drew a *different*
   * diagram rather than the same one tighter -- which is exactly what it used to
   * do. `drawnHalo` is what the spacing pass makes room for, and that does
   * follow the view: it is how the gaps come back down again.
   */
  it("sets aside the same room whether the attributes are drawn or not", () => {
    const { shown, hidden } = bothWays();
    expect(shown.haloRadius).toBeGreaterThan(0);
    expect(hidden.haloRadius).toBe(shown.haloRadius);
  });

  it("...but reports a ring only as wide as what is drawn", () => {
    const { shown, hidden } = bothWays();
    expect(shown.drawnHalo).toBe(shown.haloRadius);
    expect(hidden.drawnHalo).toBe(0);
  });

  it("holds the ring open when the gaps are told to stay", () => {
    const { hidden } = bothWays({
      ...DEFAULT_LAYOUT_PARAMS,
      spacing: { ...DEFAULT_LAYOUT_PARAMS.spacing, closeHiddenGaps: false },
    });
    expect(hidden.drawnHalo).toBe(hidden.haloRadius);
  });

  it("weighs an element by every attribute it owns, drawn or not", () => {
    // 3 attributes + 1 relationship, either way: weight sets the seed order, so
    // it is the arranging stage's number and answers to the model, not the view
    const { shown, hidden } = bothWays();
    expect(shown.weight).toBe(4);
    expect(hidden.weight).toBe(4);
  });

  it("still returns a position for every hidden attribute", () => {
    const { nodes, edges } = fromErDoc(source);
    const { positions } = layoutDiscreteSearch(hideAttributes(nodes), edges);
    expect(positions.size).toBe(nodes.length);
    for (const [, position] of positions) {
      expect(Number.isFinite(position.x)).toBe(true);
      expect(Number.isFinite(position.y)).toBe(true);
    }
  });

  it("never spreads the skeleton out because attributes were hidden", () => {
    const { nodes, edges } = fromErDoc(source);
    // measured centre to centre: a top-left spread also moves when the elements
    // at the extremes change, and a 95-wide diamond replacing a 90-wide entity
    // at one corner is not the skeleton getting looser
    const spread = (list: typeof nodes) => {
      const { positions } = layoutDiscreteSearch(list, edges);
      const structural = list.filter((node) =>
        ["entity", "relationship"].includes(node.type ?? ""),
      );
      const xs = structural.map(
        (node) => positions.get(node.id)!.x + (node.width ?? 0) / 2,
      );
      const ys = structural.map(
        (node) => positions.get(node.id)!.y + (node.height ?? 0) / 2,
      );
      return (
        Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys))
      );
    };
    // not strictly tighter: three elements in an L is already the smallest
    // arrangement there is, so on this diagram hiding the ring frees no room
    expect(spread(hideAttributes(nodes))).toBeLessThanOrEqual(spread(nodes));
  });
});

/**
 * With `relationships.asSkeleton` the search places diamonds itself, and the
 * adjacency it works on stops being a contraction of the drawn graph.
 */
describe("relationships as skeleton elements", () => {
  const source = `
entity A { a key }
entity B { b key }
entity C { c key }
relation R(A, B 1!)
relation Solo(A: [left, right 1!])
`;
  const bipartite = {
    ...DEFAULT_LAYOUT_PARAMS,
    relationships: { asSkeleton: true },
  };
  const graphOf = (params: typeof DEFAULT_LAYOUT_PARAMS) => {
    const { nodes, edges } = fromErDoc(source);
    return buildLayoutGraph(nodes, edges, params);
  };
  const keyed = (graph: ReturnType<typeof buildLayoutGraph>, key: string) =>
    [...graph.elements.values()].find((element) =>
      element.key.startsWith(key),
    )!;

  const plain = {
    ...DEFAULT_LAYOUT_PARAMS,
    relationships: { asSkeleton: false },
  };

  it("leaves the diamond a connector when the flag is off", () => {
    const graph = graphOf(plain);
    expect(keyed(graph, "relationship: R").role).toBe("connector");
    // the participants are contracted into a clique, so A and B look adjacent
    const a = keyed(graph, "entity: A");
    const b = keyed(graph, "entity: B");
    expect(graph.neighbours.get(a.id)).toContain(b.id);
  });

  it("places the diamond and puts it between its participants when on", () => {
    const graph = graphOf(bipartite);
    const relationship = keyed(graph, "relationship: R");
    const a = keyed(graph, "entity: A");
    const b = keyed(graph, "entity: B");

    expect(relationship.role).toBe("skeleton");
    // A and B are no longer adjacent -- what sits between them is the diamond,
    // and it is now there to do it
    expect(graph.neighbours.get(a.id)).not.toContain(b.id);
    expect(graph.neighbours.get(a.id)).toContain(relationship.id);
    expect(graph.neighbours.get(relationship.id)).toEqual(
      expect.arrayContaining([a.id, b.id]),
    );
  });

  it("leaves a recursive relationship a connector either way", () => {
    // its centroid is the one entity it reaches, so it has no between to occupy
    for (const params of [plain, bipartite])
      expect(keyed(graphOf(params), "relationship: Solo").role).toBe(
        "connector",
      );
  });

  const weightOf = (params: typeof DEFAULT_LAYOUT_PARAMS, key: string) => {
    const graph = graphOf(params);
    return graph.skeleton.find((element) => element.key.startsWith(key))!
      .weight;
  };

  it("weighs an element by what is drawn to it, whichever the flag", () => {
    // A: two relationships and one key attribute, both ways round
    for (const params of [plain, bipartite])
      expect(weightOf(params, "entity: A")).toBe(3);
  });

  it("weighs a placed diamond by how many things it joins", () => {
    expect(weightOf(bipartite, "relationship: R")).toBe(2);
  });
});
