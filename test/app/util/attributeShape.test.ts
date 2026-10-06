import "@testing-library/jest-dom";
import {
  ATTRIBUTE_PROBE_ATTRIBUTE,
  ATTRIBUTE_SHAPE_CLASS,
  measureAttributeShapes,
} from "../../../src/app/util/attributeShape";

const probesInDocument = () =>
  document.querySelectorAll(`[${ATTRIBUTE_PROBE_ATTRIBUTE}]`).length;

/**
 * jsdom lays nothing out, so this stands in for the browser: a probe measures
 * whatever `sizeOf` says its label is drawn at, and every read is recorded with
 * the probe it was made on, where that probe was at the time, and how many
 * probes were in the document by then.
 */
const layOut = (
  sizeOf: (label: string) => { width: number; height: number },
) => {
  const reads: {
    probe: HTMLElement;
    parent: HTMLElement | null;
    probesInDocument: number;
  }[] = [];
  const size = (element: HTMLElement) =>
    element.hasAttribute(ATTRIBUTE_PROBE_ATTRIBUTE)
      ? sizeOf(element.textContent ?? "")
      : { width: 0, height: 0 };
  jest
    .spyOn(HTMLElement.prototype, "offsetWidth", "get")
    .mockImplementation(function (this: HTMLElement) {
      reads.push({
        probe: this,
        parent: this.parentElement,
        probesInDocument: probesInDocument(),
      });
      return size(this).width;
    });
  jest
    .spyOn(HTMLElement.prototype, "offsetHeight", "get")
    .mockImplementation(function (this: HTMLElement) {
      return size(this).height;
    });
  return reads;
};

afterEach(() => {
  jest.restoreAllMocks();
  document.body.innerHTML = "";
});

describe("measureAttributeShapes", () => {
  it("measures nothing where nothing is laid out", () => {
    expect(measureAttributeShapes(["name", "e_id"])).toEqual(new Map());
    expect(probesInDocument()).toBe(0);
  });

  it("sizes each label from its own drawn shape", () => {
    layOut((label) => ({ width: 20 + 8 * label.length, height: 44 }));
    expect(measureAttributeShapes(["name", "d_number"])).toEqual(
      new Map([
        ["name", { width: 52, height: 44 }],
        ["d_number", { width: 84, height: 44 }],
      ]),
    );
  });

  it("measures a label once, however many attributes carry it", () => {
    const reads = layOut(() => ({ width: 60, height: 44 }));
    measureAttributeShapes(["name", "id", "name", "name"]);
    expect(reads.map(({ probe }) => probe.textContent)).toEqual(["name", "id"]);
  });

  // reading straight after each write would lay the page out once per label
  it("writes every probe before reading any", () => {
    const reads = layOut(() => ({ width: 60, height: 44 }));
    measureAttributeShapes(["a", "b", "c"]);
    expect(reads.map((read) => read.probesInDocument)).toEqual([3, 3, 3]);
  });

  it("says nothing about a shape that measures zero", () => {
    layOut((label) =>
      label === "ghost" ? { width: 0, height: 44 } : { width: 60, height: 44 },
    );
    expect([...measureAttributeShapes(["ghost", "name"]).keys()]).toEqual([
      "name",
    ]);
  });

  it("leaves nothing behind, even when measuring fails", () => {
    jest
      .spyOn(HTMLElement.prototype, "offsetWidth", "get")
      .mockImplementation(() => {
        throw new Error("no layout");
      });
    expect(() => measureAttributeShapes(["name"])).toThrow("no layout");
    expect(probesInDocument()).toBe(0);
  });

  it("draws its probes among the nodes, when there are any", () => {
    const nodes = document.createElement("div");
    nodes.className = "react-flow__nodes";
    document.body.append(nodes);
    const reads = layOut(() => ({ width: 60, height: 44 }));
    measureAttributeShapes(["name"]);
    expect(reads.map(({ parent }) => parent)).toEqual([nodes]);
    expect(nodes.children).toHaveLength(0);
  });

  it("builds the shape DefaultAttribute draws, in a box that measures it the way React Flow does", () => {
    const reads = layOut(() => ({ width: 60, height: 44 }));
    measureAttributeShapes(["name"]);
    const [{ probe }] = reads;

    // absolute, so it shrinks to fit the shape the way a node's wrapper does;
    // hidden by visibility, which still lays it out
    expect(probe.style.position).toBe("absolute");
    expect(probe.style.visibility).toBe("hidden");
    expect(probe.hasAttribute("hidden")).toBe(false);

    const shape = probe.firstElementChild!;
    expect(shape).toHaveAttribute("class", ATTRIBUTE_SHAPE_CLASS);
    expect(Array.from(shape.children).map((child) => child.tagName)).toEqual([
      "P",
      "P",
    ]);
    expect(shape.children[0].textContent).toBe("name");
  });
});
