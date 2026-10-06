/**
 * The name drawn on one role of a relationship, and the room it needs.
 *
 * An entity can fill more than one role in the same relationship, and those
 * lines are drawn bowed apart with their names at the widest point -- in the
 * gap between the diamond and its entity, which is the only place they can go.
 * So the gap has to be sized from the names, and the names have to be bounded,
 * or a long one sets the width of that part of the diagram.
 *
 * Free of React and of React Flow, because the layout reads from here too.
 */

/**
 * How wide a role's name may be drawn before it is cut short with an ellipsis.
 *
 * Measured against real names at the size these are drawn at (11px, weight
 * 500): "Management" is 64px and "ActingDepartmentHead" 114px, so this clears
 * the ones people actually write and truncates the ones that would otherwise
 * decide how far a diamond sits from its entity. The full name stays on the
 * element's `title`, so a truncated one can still be read.
 */
export const ROLE_LABEL_MAX_WIDTH = 120;

/**
 * Marks a rendered role name with the id of the edge it belongs to.
 *
 * This is what lets the layout size the gap from the names actually on screen
 * rather than from a guess: text width depends on the font the browser picked
 * and on the characters -- all-caps runs to 10px a character at this size and
 * lowercase to under 3 -- so no formula computed away from the DOM gets it
 * right. Read with `offsetWidth`, which is the laid-out width in CSS pixels and
 * ignores the canvas zoom, and is already the *truncated* width when the name
 * was too long -- so what the layout makes room for is exactly what is drawn.
 */
export const ROLE_LABEL_EDGE_ATTRIBUTE = "data-role-label";

/** The style every role name is drawn with, so the three notations agree. */
export const roleLabelStyle = (
  x: number,
  y: number,
  padding: number,
): React.CSSProperties => ({
  position: "absolute",
  transform: `translate(-50%, -50%) translate(${x}px,${y}px)`,
  background: "#F8FAFC",
  padding,
  borderRadius: 5,
  fontSize: 11,
  fontWeight: 500,
  maxWidth: ROLE_LABEL_MAX_WIDTH,
  overflow: "hidden",
  textOverflow: "ellipsis",
  whiteSpace: "nowrap",
});

/**
 * How wide each role name currently is on screen, by the id of its edge.
 *
 * Empty away from a browser -- on the server, and in the tests, which inject
 * what they need instead. A caller with nothing measured falls back to a fixed
 * gap rather than to no gap.
 */
export const measureRoleLabels = (): Map<string, number> => {
  const widths = new Map<string, number>();
  if (typeof document === "undefined") return widths;

  for (const element of document.querySelectorAll(
    `[${ROLE_LABEL_EDGE_ATTRIBUTE}]`,
  )) {
    const id = element.getAttribute(ROLE_LABEL_EDGE_ATTRIBUTE);
    const width = (element as HTMLElement).offsetWidth;
    if (id !== null && width > 0) widths.set(id, width);
  }

  return widths;
};
