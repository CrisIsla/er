import {
  HistoryAction,
  historyShortcut,
} from "../../../src/app/util/historyShortcut";

/**
 * What the rule makes of a keydown dispatched on `target`, read the way the
 * diagram reads it: from a listener on the document, as the event bubbles.
 */
const press = (
  init: KeyboardEventInit,
  { target = document.body, isMac = false } = {},
): HistoryAction | null | undefined => {
  let action: HistoryAction | null | undefined;
  const listener = (event: KeyboardEvent) => {
    action = historyShortcut(event, isMac);
  };
  document.addEventListener("keydown", listener);
  target.dispatchEvent(
    new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init }),
  );
  document.removeEventListener("keydown", listener);
  return action;
};

const mount = (html: string, selector: string) => {
  document.body.innerHTML = html;
  return document.querySelector(selector) as HTMLElement;
};

afterEach(() => {
  document.body.innerHTML = "";
});

const ctrl = (key: string, extra: KeyboardEventInit = {}) => ({
  key,
  code: `Key${key.toUpperCase()}`,
  ctrlKey: true,
  ...extra,
});

describe("historyShortcut", () => {
  it("undoes on Ctrl+Z and redoes on Ctrl+Y and Ctrl+Shift+Z", () => {
    expect(press(ctrl("z"))).toBe("undo");
    expect(press(ctrl("y"))).toBe("redo");
    // a real keyboard reports the capital with Shift held
    expect(press(ctrl("Z", { shiftKey: true }))).toBe("redo");
  });

  it("ignores letters that are not Z or Y, and Z or Y alone", () => {
    expect(press(ctrl("a"))).toBeNull();
    expect(press({ key: "z", code: "KeyZ" })).toBeNull();
    expect(press(ctrl("y", { shiftKey: true }))).toBeNull();
  });

  it("uses Cmd on a Mac, where Cmd+Y is not redo", () => {
    const cmd = (key: string, extra: KeyboardEventInit = {}) => ({
      key,
      code: `Key${key.toUpperCase()}`,
      metaKey: true,
      ...extra,
    });
    expect(press(cmd("z"), { isMac: true })).toBe("undo");
    expect(press(cmd("Z", { shiftKey: true }), { isMac: true })).toBe("redo");
    expect(press(cmd("y"), { isMac: true })).toBeNull();
    expect(press(ctrl("z"), { isMac: true })).toBeNull();
    expect(press(cmd("z"))).toBeNull();
  });

  it("leaves AltGr alone, which Windows reports as Ctrl+Alt", () => {
    expect(press(ctrl("z", { altKey: true }))).toBeNull();
  });

  it("leaves an event somebody already handled, or an IME composition", () => {
    const button = mount("<button>b</button>", "button");
    button.addEventListener("keydown", (event) => event.preventDefault());
    expect(press(ctrl("z"), { target: button })).toBeNull();
    expect(press(ctrl("z", { isComposing: true }))).toBeNull();
  });

  it("falls back to the physical key on a layout without Latin letters", () => {
    expect(press({ key: "я", code: "KeyZ", ctrlKey: true })).toBe("undo");
  });

  it("leaves a layout with Latin keys alone where the letter is not: Dvorak's ';'", () => {
    expect(press({ key: ";", code: "KeyZ", ctrlKey: true })).toBeNull();
  });

  it("leaves the diagram alone while a modal dialog is open, wherever the focus is", () => {
    document.body.innerHTML =
      '<button id="opener">New</button><div role="dialog" aria-modal="true"><h2>Name</h2></div>';
    const opener = document.getElementById("opener")!;
    expect(press(ctrl("z"), { target: opener })).toBeNull();
    expect(press(ctrl("z"))).toBeNull();
  });

  it("follows the layout where it has the letter: on QWERTZ, Z is the key printed Z", () => {
    expect(press({ key: "z", code: "KeyY", ctrlKey: true })).toBe("undo");
  });

  describe("where the keypress happens", () => {
    it.each([
      [
        "the code editor",
        '<div class="monaco-editor"><textarea></textarea></div>',
        "textarea",
      ],
      ["a text area", "<textarea></textarea>", "textarea"],
      ["a text field", '<input type="text">', "input"],
      ["an input without a type", "<input>", "input"],
      ["a number field", '<input type="number">', "input"],
      ["a select", "<select></select>", "select"],
      [
        "editable content",
        '<div contenteditable="true"><span>t</span></div>',
        "span",
      ],
      [
        "an open modal",
        '<section aria-modal="true"><button>x</button></section>',
        "button",
      ],
    ])("leaves the undo to %s", (_name, html, selector) => {
      expect(press(ctrl("z"), { target: mount(html, selector) })).toBeNull();
    });

    it.each([
      ["a button", "<button>b</button>", "button"],
      ["a radio", '<input type="radio">', "input"],
      ["a checkbox", '<input type="checkbox">', "input"],
      [
        "a node of the diagram",
        '<div class="react-flow__node" tabindex="0"></div>',
        "div",
      ],
      [
        "content marked not editable",
        '<div contenteditable="false"><span>t</span></div>',
        "span",
      ],
      [
        "a dialog that is not modal",
        '<section role="dialog"><input type="radio"></section>',
        "input",
      ],
    ])("undoes the diagram from %s", (_name, html, selector) => {
      expect(press(ctrl("z"), { target: mount(html, selector) })).toBe("undo");
    });
  });
});
