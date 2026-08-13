/**
 * Shared fixtures for the layout tests.
 *
 * Not a suite -- Jest only picks up *.test.* / *.spec.* files.
 *
 * Diagrams are built through the real pipeline (`getERDoc` then
 * `erToReactflowElements`) so the tests exercise the ids, edge orientations and
 * aggregation re-parenting the app actually produces. The one thing that cannot
 * come from the real pipeline is node dimensions: React Flow measures them with
 * offsetWidth/offsetHeight, which jsdom always reports as 0, so they are
 * injected here from the sizes the notation components render at.
 */

import { getERDoc } from "../../../../src/ERDoc";
import { erToReactflowElements } from "../../../../src/app/util/erToReactflowElements";
import { LayoutInputNode } from "../../../../src/app/util/layout/buildLayoutGraph";
import aggregation from "../../../../src/app/static/examples/aggregation.json";
import bank from "../../../../src/app/static/examples/bank.json";
import company from "../../../../src/app/static/examples/company.json";
import roles from "../../../../src/app/static/examples/roles.json";
import subclass from "../../../../src/app/static/examples/subclass.json";

type Size = { width: number; height: number };

/** Minimum box per node type, from the Tailwind classes in notations/Default*.tsx. */
const MIN_SIZES: Record<string, Size> = {
  entity: { width: 90, height: 44 },
  relationship: { width: 95, height: 95 },
  isA: { width: 96, height: 64 },
  "entity-attribute": { width: 60, height: 44 },
  "relationship-attribute": { width: 60, height: 44 },
  "composite-attribute": { width: 60, height: 44 },
  aggregation: { width: 500, height: 500 },
};

/**
 * Widths grow with the label, the way a `min-w-[...] p-2` box does. The diamond
 * and the triangle are fixed-size, and the aggregation carries its own style.
 */
const sizeOf = (node: { type?: string; data?: { label?: string } }): Size => {
  const min = MIN_SIZES[node.type ?? ""] ?? { width: 90, height: 44 };
  if (node.type === "relationship" || node.type === "isA") return min;
  if (node.type === "aggregation") return min;
  const label = node.data?.label ?? "";
  return {
    width: Math.max(min.width, label.length * 8 + 20),
    height: min.height,
  };
};

export const withMeasuredSizes = <T extends LayoutInputNode>(nodes: T[]): T[] =>
  nodes.map((node) => ({ ...node, ...sizeOf(node) }));

/** ERdoc source -> the nodes and edges the diagram would render, with sizes. */
export const fromErDoc = (source: string) => {
  const [er] = getERDoc(source);
  const [nodes, edges] = erToReactflowElements(er, () => ({}));
  return {
    nodes: withMeasuredSizes(nodes as unknown as LayoutInputNode[]),
    edges,
  };
};

export type Example = {
  name: string;
  erDoc: string;
  /** the hand-made layout shipped with the example, as a human baseline */
  humanPositions: { id: string; position: { x: number; y: number } }[];
};

export const EXAMPLES: Example[] = [
  { name: "roles", erDoc: roles.erDoc, humanPositions: roles.nodes },
  {
    name: "aggregation",
    erDoc: aggregation.erDoc,
    humanPositions: aggregation.nodes,
  },
  { name: "subclass", erDoc: subclass.erDoc, humanPositions: subclass.nodes },
  { name: "bank", erDoc: bank.erDoc, humanPositions: bank.nodes },
  { name: "company", erDoc: company.erDoc, humanPositions: company.nodes },
];

/** A small hand-written diagram with a composite attribute. */
export const COMPOSITE_ERDOC = `
entity Person {
  id key
  address: [street, city]
}
`;
