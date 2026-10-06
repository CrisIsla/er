/**
 * How big an attribute is drawn, worked out from its label.
 *
 * The layout reads the size of every attribute an element owns, drawn or not --
 * that is what keeps hiding the attributes from rearranging the diagram
 * (buildLayoutGraph.ts, `declaredAttributes`). But the only size React Flow
 * holds for a node is the one it measured, and it never measures a hidden one.
 * Worse, it carries a node's measured size forward **by id**, and this app's
 * ids are array indices that every diagram reuses, so a hidden attribute can be
 * wearing the size of whatever another diagram drew at its id. The same model
 * with the same settings used to lay out differently depending on what had been
 * on screen before.
 *
 * Measuring the shape off the label instead gives an attribute the size it is
 * drawn at, whether it is drawn or not and whatever held its id before. The
 * shape is the one DefaultAttribute draws -- one class string for both, so the
 * probe cannot drift from the node -- and nothing but the label changes its
 * box: a key's underline and a weak entity's dashes are decoration, and a label
 * cannot wrap, because a name has no spaces in it (er-parser.pegjs,
 * `validWord`). A variant that ever did change the box would have to become
 * part of the key.
 *
 * Free of React and of React Flow, because the layout reads from here too.
 */

import { NodeSize } from "./nodeSize";

/** The shape an attribute is drawn as: DefaultAttribute renders it, the probe below measures it. */
export const ATTRIBUTE_SHAPE_CLASS =
  "min-w-[60px] rounded-[50%] border-2 border-yellow-300 bg-yellow-100 p-2 text-center";

/** Marks a probe, so that nothing takes one for a node. */
export const ATTRIBUTE_PROBE_ATTRIBUTE = "data-attribute-probe";

/**
 * Where the probes are drawn: among the nodes, so they inherit exactly what a
 * node does. React Flow sets no font of its own, so anywhere under the body
 * would measure the same -- but this is the nodes' own parent, and it and each
 * fallback are pane-sized boxes.
 */
const probeHost = () =>
  document.querySelector<HTMLElement>(".react-flow__nodes") ??
  document.querySelector<HTMLElement>(".react-flow__viewport") ??
  document.body;

/**
 * One probe, wrapped the way React Flow wraps a node: absolutely positioned, so
 * it shrinks to fit the shape instead of stretching across the pane, and pinned
 * to the corner, so nothing in normal flow can nudge it by a fraction of a
 * pixel. `visibility` rather than `display` or `hidden`, both of which would
 * measure nothing -- Chakra's reset turns `[hidden]` into `display: none`.
 */
const probeFor = (label: string) => {
  const probe = document.createElement("div");
  probe.setAttribute(ATTRIBUTE_PROBE_ATTRIBUTE, "");
  probe.style.cssText =
    "position:absolute;left:0;top:0;visibility:hidden;pointer-events:none";

  const shape = document.createElement("div");
  shape.className = ATTRIBUTE_SHAPE_CLASS;
  const text = document.createElement("p");
  text.textContent = label;
  shape.append(text, document.createElement("p"));

  probe.append(shape);
  return probe;
};

/**
 * How big each label's attribute is drawn, by label.
 *
 * Read with `offsetWidth`/`offsetHeight`, which is what React Flow measures a
 * node with: the laid-out size in CSS pixels, untouched by the canvas zoom.
 * Every probe is written before any is read, so the browser lays them out once.
 *
 * Empty away from a browser -- on the server, and in the tests, where nothing
 * is laid out and everything measures zero. A caller with nothing measured
 * falls back to what it knew before.
 */
export const measureAttributeShapes = (
  labels: Iterable<string>,
): Map<string, NodeSize> => {
  const sizes = new Map<string, NodeSize>();
  if (typeof document === "undefined") return sizes;

  const probes = [...new Set(labels)].map(
    (label) => [label, probeFor(label)] as const,
  );
  if (probes.length === 0) return sizes;

  const batch = document.createDocumentFragment();
  for (const [, probe] of probes) batch.append(probe);
  probeHost().append(batch);

  try {
    for (const [label, probe] of probes) {
      const width = probe.offsetWidth;
      const height = probe.offsetHeight;
      if (width > 0 && height > 0) sizes.set(label, { width, height });
    }
  } finally {
    for (const [, probe] of probes) probe.remove();
  }

  return sizes;
};
