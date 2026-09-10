/**
 * The hover box that lists what an element owns when the attributes are not
 * drawn on the canvas.
 *
 * Two halves, tested separately because they fail for different reasons: reading
 * the graph (which attributes, whose, in what order) and drawing the box (what a
 * key looks like, how a composite nests).
 */

import "@testing-library/jest-dom";
import { render } from "@testing-library/react";
import {
  AttributeList,
  attributesOf,
} from "../../../src/app/components/ErDiagram/AttributeTooltip";
import { getERDoc } from "../../../src/ERDoc";
import { erToReactflowElements } from "../../../src/app/util/erToReactflowElements";

const fromErDoc = (source: string) => {
  const [er] = getERDoc(source);
  const [nodes, edges] = erToReactflowElements(er, () => ({}));
  return { nodes, edges } as unknown as {
    nodes: { id: string; type?: string; data?: { label?: string } }[];
    edges: { id: string; source: string; target: string }[];
  };
};

const idOf = (
  nodes: { id: string; data?: { erId?: string } }[],
  erId: string,
) => nodes.find((node) => node.data?.erId === erId)!.id;

describe("attributesOf", () => {
  const source = `
    entity Person {
      p_id key
      name
      address: [street, city]
    }
    entity Pet { tag key }
    relation Owns(Person, Pet) {
      since
    }
  `;
  const { nodes, edges } = fromErDoc(source);
  const listFor = (erId: string) =>
    attributesOf(nodes, edges, idOf(nodes as never, erId));
  const labels = (erId: string) =>
    listFor(erId).map((attribute) => attribute.data.label);

  it("lists an entity's attributes in the order the ERdoc declares them", () => {
    expect(labels("entity: Person")).toEqual(["p_id", "name", "address"]);
  });

  it("nests a composite attribute's parts under it rather than beside them", () => {
    const address = listFor("entity: Person").find(
      (attribute) => attribute.data.label === "address",
    )!;
    expect(address.children.map((child) => child.data.label)).toEqual([
      "street",
      "city",
    ]);
  });

  it("carries whether an attribute is a key", () => {
    const byLabel = new Map(
      listFor("entity: Person").map((attribute) => [
        attribute.data.label,
        attribute.data.isKey,
      ]),
    );
    expect(byLabel.get("p_id")).toBe(true);
    expect(byLabel.get("name")).toBeFalsy();
  });

  it("lists a relationship's own attributes", () => {
    expect(labels("relationship: Owns$Person$Pet")).toEqual(["since"]);
  });

  it("gives an element none of anybody else's", () => {
    expect(labels("entity: Pet")).toEqual(["tag"]);
  });

  it("finds nothing for an element that owns nothing", () => {
    const bare = fromErDoc("entity Alone {}\nentity Other { id key }");
    expect(
      attributesOf(
        bare.nodes,
        bare.edges,
        idOf(bare.nodes as never, "entity: Alone"),
      ),
    ).toEqual([]);
  });
});

describe("AttributeList", () => {
  const listed = (
    label: string,
    extra: { isKey?: boolean; entityIsWeak?: boolean } = {},
    children: string[] = [],
  ) => ({
    id: label,
    data: { label, ...extra },
    children: children.map((child) => ({ id: child, data: { label: child } })),
  });

  it("names the element the list belongs to", () => {
    const { getByText } = render(
      <AttributeList title="Person" attributes={[listed("name")]} />,
    );
    expect(getByText("Person")).toBeInTheDocument();
  });

  it("underlines a key, the way the canvas draws one", () => {
    const { getByText } = render(
      <AttributeList attributes={[listed("p_id", { isKey: true })]} />,
    );
    expect(getByText("p_id")).toHaveClass("underline");
  });

  it("dashes that underline when the entity is weak", () => {
    const { getByText } = render(
      <AttributeList
        attributes={[listed("p_id", { isKey: true, entityIsWeak: true })]}
      />,
    );
    expect(getByText("p_id")).toHaveClass("decoration-dashed");
  });

  it("leaves a plain attribute undecorated", () => {
    const { getByText } = render(
      <AttributeList attributes={[listed("name")]} />,
    );
    expect(getByText("name")).not.toHaveClass("underline");
  });

  it("draws a composite's parts inside it", () => {
    const { getByText } = render(
      <AttributeList
        attributes={[listed("address", {}, ["street", "city"])]}
      />,
    );
    expect(getByText("street")).toBeInTheDocument();
    expect(getByText("address").closest("li")).toContainElement(
      getByText("city"),
    );
  });
});
