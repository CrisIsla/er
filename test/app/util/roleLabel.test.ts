/**
 * Reading the role names back off the page.
 *
 * The layout sizes a recursive relationship's gap from the names drawn in it,
 * and text width is not something it can work out for itself: at the size these
 * are drawn, a run of capitals is over 10px a character and a run of lowercase
 * under 3. So the width is taken from the elements themselves, and this is the
 * seam between the two.
 */

import {
  ROLE_LABEL_EDGE_ATTRIBUTE,
  ROLE_LABEL_MAX_WIDTH,
  measureRoleLabels,
  roleLabelStyle,
} from "../../../src/app/util/roleLabel";

/** A rendered role name, with the width jsdom will not work out for itself. */
const drawLabel = (edgeId: string, width: number) => {
  const element = document.createElement("div");
  element.setAttribute(ROLE_LABEL_EDGE_ATTRIBUTE, edgeId);
  Object.defineProperty(element, "offsetWidth", { value: width });
  document.body.append(element);
  return element;
};

describe("measureRoleLabels", () => {
  afterEach(() => {
    document.body.innerHTML = "";
  });

  it("reports each name by the id of the edge it belongs to", () => {
    drawLabel("1relationship-part: Manages->Employee->Intern", 28);
    drawLabel("4relationship-part: Manages->Employee->Manager", 43);

    expect([...measureRoleLabels()]).toEqual([
      ["1relationship-part: Manages->Employee->Intern", 28],
      ["4relationship-part: Manages->Employee->Manager", 43],
    ]);
  });

  /**
   * A label React has rendered but the browser has not laid out yet measures
   * zero. Reporting that would tell the layout the name takes no room, which is
   * worse than telling it nothing: nothing falls back to a fixed gap.
   */
  it("says nothing about a name that has not been laid out", () => {
    drawLabel("1relationship-part: unmeasured", 0);

    expect(measureRoleLabels().size).toBe(0);
  });

  it("finds nothing at all when there are no role names", () => {
    expect(measureRoleLabels().size).toBe(0);
  });
});

describe("roleLabelStyle", () => {
  /**
   * The cap is what makes the gap bounded: a name is truncated to it, and
   * `offsetWidth` then reports the truncated width -- so the room the layout
   * makes is the room the name actually takes, however long it was written.
   */
  it("truncates a name rather than letting it set the width of the diagram", () => {
    const style = roleLabelStyle(10, 20, 3);

    expect(style.maxWidth).toBe(ROLE_LABEL_MAX_WIDTH);
    expect(style.textOverflow).toBe("ellipsis");
    expect(style.overflow).toBe("hidden");
    expect(style.whiteSpace).toBe("nowrap");
  });

  it("puts the name where it was asked to", () => {
    expect(roleLabelStyle(10, 20, 3).transform).toContain(
      "translate(10px,20px)",
    );
  });
});
