/**
 * The force-directed layout reads node sizes as well, so it has to be handed
 * the sizes the aligned one is (layout/toReactflow.ts, `sizedForLayout`):
 * otherwise a hidden attribute lays out at whatever size React Flow happens to
 * be holding for its id.
 */

import { Edge, Node } from "reactflow";
import { getLayoutedElements } from "../../../src/app/hooks/useLayoutedElements";
import company from "../../../src/app/static/examples/company.json";
import { ATTRIBUTE_PROBE_ATTRIBUTE } from "../../../src/app/util/attributeShape";
import { isAttributeNode } from "../../../src/app/util/erGraph";
import { LayoutInputNode } from "../../../src/app/util/layout/buildLayoutGraph";
import { fromErDoc, sizeOf } from "../util/layout/fixtures";

const { nodes: built, edges } = fromErDoc(company.erDoc);

const withAttributes = (change: (node: LayoutInputNode) => LayoutInputNode) =>
  built.map((node) => (isAttributeNode(node) ? change(node) : node));

const neverDrawn = withAttributes((node) => ({
  ...node,
  hidden: true,
  width: undefined,
  height: undefined,
}));
const drawnThenHidden = withAttributes((node) => ({ ...node, hidden: true }));
const leftovers = withAttributes((node) => ({
  ...node,
  hidden: true,
  width: 240,
  height: 95,
}));

/** Where the force-directed layout puts every node. It rewrites what it is given, so each run gets its own copy. */
const positions = async (nodes: LayoutInputNode[]) => {
  const copy = <T>(value: T): T => JSON.parse(JSON.stringify(value));
  const laidOut = await getLayoutedElements(
    copy(nodes) as unknown as Node[],
    copy(edges) as Edge[],
  );
  return new Map(laidOut.map((node) => [node.id, node.position]));
};

describe("getLayoutedElements, where nothing can be measured", () => {
  it("lays hidden attributes out the same, whatever size they were left wearing", async () => {
    // it does read attribute sizes -- drawn ones, made bigger, move things --
    // so agreeing below is not just indifference
    const bigger = withAttributes((node) => ({
      ...node,
      width: 240,
      height: 95,
    }));
    expect(await positions(bigger)).not.toEqual(await positions(built));

    const expected = await positions(neverDrawn);
    expect(await positions(leftovers)).toEqual(expected);
    expect(await positions(drawnThenHidden)).toEqual(expected);
  });
});

describe("getLayoutedElements, in a browser", () => {
  const measured = (element: HTMLElement) =>
    element.hasAttribute(ATTRIBUTE_PROBE_ATTRIBUTE)
      ? sizeOf({
          type: "entity-attribute",
          data: { label: element.textContent ?? "" },
        })
      : { width: 0, height: 0 };

  beforeEach(() => {
    jest
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockImplementation(function (this: HTMLElement) {
        return measured(this).width;
      });
    jest
      .spyOn(HTMLElement.prototype, "offsetHeight", "get")
      .mockImplementation(function (this: HTMLElement) {
        return measured(this).height;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("sizes every attribute from its label, however it came to be hidden", async () => {
    const expected = await positions(drawnThenHidden);
    expect(await positions(neverDrawn)).toEqual(expected);
    expect(await positions(leftovers)).toEqual(expected);
  });
});
