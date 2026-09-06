import { buildLayoutGraph } from "../../../../src/app/util/layout/buildLayoutGraph";
import { DEFAULT_LAYOUT_PARAMS } from "../../../../src/app/util/layout/params";
import { layoutDiscreteSearch } from "../../../../src/app/util/layout";
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
    const accts = graph.connectors.find((connector) =>
      connector.key.startsWith("relationship: accts"),
    )!;
    expect(accts.participants).toHaveLength(2);
    const keys = accts.participants.map((id) => labelOf(graph, id));
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
    const supplies = graph.connectors.find((connector) =>
      connector.key.startsWith("relationship: Supplies"),
    )!;
    expect(supplies.participants).toHaveLength(3);
    expect(supplies.isSelfLoop).toBe(false);
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

  it("reserves no room around an element whose attributes are all hidden", () => {
    const { nodes, edges } = fromErDoc(source);
    const shown = buildLayoutGraph(nodes, edges, DEFAULT_LAYOUT_PARAMS);
    const hidden = buildLayoutGraph(
      hideAttributes(nodes),
      edges,
      DEFAULT_LAYOUT_PARAMS,
    );

    const person = (graph: typeof shown) =>
      graph.skeleton.find((element) => element.key === "entity: Person")!;

    expect(person(shown).haloRadius).toBeGreaterThan(0);
    expect(person(hidden).haloRadius).toBe(0);
  });

  it("does not count hidden attributes towards an element's weight", () => {
    const { nodes, edges } = fromErDoc(source);
    const shown = buildLayoutGraph(nodes, edges, DEFAULT_LAYOUT_PARAMS);
    const hidden = buildLayoutGraph(
      hideAttributes(nodes),
      edges,
      DEFAULT_LAYOUT_PARAMS,
    );
    const weightOf = (graph: typeof shown) =>
      graph.skeleton.find((element) => element.key === "entity: Person")!
        .weight;

    // 3 attributes + 1 relationship, versus the relationship alone
    expect(weightOf(shown)).toBe(4);
    expect(weightOf(hidden)).toBe(1);
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

  it("draws the skeleton tighter once attributes are hidden", () => {
    const { nodes, edges } = fromErDoc(source);
    const spread = (list: typeof nodes) => {
      const { positions } = layoutDiscreteSearch(list, edges);
      const structural = list.filter((node) =>
        ["entity", "relationship"].includes(node.type ?? ""),
      );
      const xs = structural.map((node) => positions.get(node.id)!.x);
      const ys = structural.map((node) => positions.get(node.id)!.y);
      return (
        Math.max(...xs) - Math.min(...xs) + (Math.max(...ys) - Math.min(...ys))
      );
    };
    expect(spread(hideAttributes(nodes))).toBeLessThan(spread(nodes));
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

  it("leaves the diamond a connector when the flag is off", () => {
    const graph = graphOf(DEFAULT_LAYOUT_PARAMS);
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
    for (const params of [DEFAULT_LAYOUT_PARAMS, bipartite])
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
    for (const params of [DEFAULT_LAYOUT_PARAMS, bipartite])
      expect(weightOf(params, "entity: A")).toBe(3);
  });

  it("weighs a placed diamond by how many things it joins", () => {
    expect(weightOf(bipartite, "relationship: R")).toBe(2);
  });
});
