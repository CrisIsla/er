/**
 * Which keypresses undo or redo the diagram.
 *
 * Ctrl+Z, Ctrl+Y and Ctrl+Shift+Z (Cmd+Z and Cmd+Shift+Z on a Mac) belong to
 * the diagram unless the keypress happens where text is being edited: there
 * the element's own undo owns them -- Monaco's for the code, the browser's for
 * a form field. Monaco stops the combinations it handles itself, but not the
 * ones it does not (Cmd+Z on Linux bubbles out of it), so it is excluded by
 * where the event comes from rather than trusted to swallow it.
 *
 * Buttons, radios and checkboxes do not edit text, so Ctrl+Z right after using
 * one still undoes the diagram. An open modal dialog does block it, wherever
 * the focus is: whatever is behind the dialog is not what the user is working
 * on, and not every dialog here moves the focus into itself.
 */

export type HistoryAction = "undo" | "redo";

const TEXT_INPUT_TYPES = new Set([
  "text",
  "search",
  "url",
  "tel",
  "email",
  "password",
  "number",
  "date",
  "datetime-local",
  "month",
  "time",
  "week",
]);

const hasOwnUndo = (target: EventTarget | null): boolean => {
  if (!(target instanceof Element)) return false;
  if (
    target.closest(
      '.monaco-editor, [contenteditable]:not([contenteditable="false"])',
    )
  )
    return true;
  if (target instanceof HTMLTextAreaElement) return true;
  if (target instanceof HTMLSelectElement) return true;
  return (
    target instanceof HTMLInputElement && TEXT_INPUT_TYPES.has(target.type)
  );
};

/**
 * The letter pressed. `key` honours the layout -- on a German keyboard Ctrl+Z
 * is the key printed Z, wherever it sits -- and `code` is the fallback for
 * layouts whose letters are not Latin. Only for those: on Dvorak the key where
 * QWERTY has Z types ';', and Ctrl+; is not undo.
 */
const letterOf = (event: KeyboardEvent): string => {
  if (/^[a-z]$/i.test(event.key)) return event.key.toLowerCase();
  if (/^[\x20-\x7e]$/.test(event.key)) return "";
  if (event.code === "KeyZ") return "z";
  if (event.code === "KeyY") return "y";
  return "";
};

export const historyShortcut = (
  event: KeyboardEvent,
  isMac: boolean,
): HistoryAction | null => {
  // Alt is also how Windows reports AltGr, which types characters
  if (event.defaultPrevented || event.isComposing || event.altKey) return null;
  const modifier = isMac
    ? event.metaKey && !event.ctrlKey
    : event.ctrlKey && !event.metaKey;
  if (!modifier) return null;
  if (hasOwnUndo(event.composedPath?.()[0] ?? event.target)) return null;
  if (document.querySelector('[aria-modal="true"]') !== null) return null;

  const letter = letterOf(event);
  if (letter === "z") return event.shiftKey ? "redo" : "undo";
  // Cmd+Y is History in Safari; a Mac redoes with Cmd+Shift+Z
  if (letter === "y" && !event.shiftKey && !isMac) return "redo";
  return null;
};

/** The platform test React Flow uses for its own Cmd/Ctrl keys. */
export const isMacPlatform = () =>
  typeof navigator !== "undefined" && navigator.userAgent.includes("Mac");
