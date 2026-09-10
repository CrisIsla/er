import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Edge,
  NodeMouseHandler,
  ReactFlowState,
  useReactFlow,
  useStore,
} from "reactflow";
import { buildOwnerMap, isAttributeNode } from "../util/erGraph";
import { useDiagramSettings } from "./useDiagramSettings";

/**
 * True once every node the diagram is drawing has been measured, so this does
 * not act on a half-built diagram.
 *
 * **Hidden nodes are exempt, and must be.** React Flow renders `null` for a
 * hidden node and only observes it while it is visible, so one that is created
 * already hidden is never measured at all -- and every semantic edit creates
 * exactly that, because the rebuild makes fresh nodes from the AST and this
 * setting decides they start hidden. Counting them left the condition
 * permanently false after the first keystroke, which turned this whole hook off:
 * the attributes could no longer be brought back, because the setting reaches
 * the nodes only through here.
 */
const nodesMeasuredSelector = (state: ReactFlowState) =>
  Array.from(state.nodeInternals.values()).every(
    (node) => node.hidden || (node.width && node.height),
  );

/**
 * Cheap fingerprint of everything this hook cares about: how many attribute
 * nodes and edges exist, and how many are currently hidden.
 *
 * Two other parts of the diagram reset visibility behind our back --
 * useLayoutedElements unhides *every* edge after a layout pass, and ErDiagram
 * rebuilds nodes from the AST whenever the ERdoc changes, dropping the `hidden`
 * flag. Watching this fingerprint means we notice and re-apply, instead of
 * leaving edges dangling towards invisible nodes.
 */
const visibilityFingerprint = (state: ReactFlowState) => {
  const attributeIds = new Set<string>();
  let attributes = 0;
  let hiddenNodes = 0;
  for (const node of state.nodeInternals.values()) {
    if (!isAttributeNode(node)) continue;
    attributeIds.add(node.id);
    attributes++;
    if (node.hidden) hiddenNodes++;
  }
  let attributeEdges = 0;
  let hiddenEdges = 0;
  for (const edge of state.edges) {
    if (!attributeIds.has(edge.source) && !attributeIds.has(edge.target))
      continue;
    attributeEdges++;
    if (edge.hidden) hiddenEdges++;
  }
  return `${attributes}:${hiddenNodes}:${attributeEdges}:${hiddenEdges}`;
};

/** Which nodes own at least one attribute, so hovering one is worth a box. */
const ownersSelector = (state: ReactFlowState) => {
  const nodes = Array.from(state.nodeInternals.values());
  const { owner } = buildOwnerMap(nodes, state.edges);
  return [...new Set(owner.values())].sort().join("|");
};

/**
 * Keeps attribute nodes (and their edges) in sync with the attribute setting,
 * and reports which element the pointer is over.
 *
 * Uses `hidden` rather than removing the nodes on purpose: hidden nodes stay in
 * `nodeInternals`, so the counts nothing else has to re-derive don't change and
 * the diagram doesn't re-layout every time attributes are toggled.
 *
 * `hoveredOwnerId` is what the hover box hangs off (AttributeTooltip.tsx): the
 * element under the pointer, but only while the attributes are not drawn and
 * only if it actually owns any. Null the rest of the time, so the common case
 * renders nothing at all.
 */
export const useAttributeVisibility = () => {
  const { settings } = useDiagramSettings();
  const { getNodes, getEdges, setNodes, setEdges } = useReactFlow();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const nodesMeasured = useStore(nodesMeasuredSelector);
  const fingerprint = useStore(visibilityFingerprint);
  const owners = useStore(ownersSelector);

  const onNodeMouseEnter: NodeMouseHandler = useCallback((_evt, node) => {
    setHoveredId(node.id);
  }, []);

  const onNodeMouseLeave: NodeMouseHandler = useCallback((_evt, node) => {
    // if the pointer already moved onto another node, that enter has landed
    // first and we must not clear it
    setHoveredId((current) => (current === node.id ? null : current));
  }, []);

  const { showAttributes } = settings;

  const ownsAttributes = useMemo(() => new Set(owners.split("|")), [owners]);
  const hoveredOwnerId =
    !showAttributes && hoveredId !== null && ownsAttributes.has(hoveredId)
      ? hoveredId
      : null;

  useEffect(() => {
    if (!nodesMeasured) return;

    const nodes = getNodes();
    const edges = getEdges();
    const { attributeIds } = buildOwnerMap(nodes, edges);
    if (attributeIds.size === 0) return;

    const hide = !showAttributes;
    const touchesAttribute = (edge: Edge) =>
      attributeIds.has(edge.source) || attributeIds.has(edge.target);

    const nodesChanged = nodes.some(
      (node) => attributeIds.has(node.id) && Boolean(node.hidden) !== hide,
    );
    const edgesChanged = edges.some(
      (edge) => touchesAttribute(edge) && Boolean(edge.hidden) !== hide,
    );

    // bail when nothing differs, so applying state can't feed back into the
    // fingerprint and loop
    if (!nodesChanged && !edgesChanged) return;

    if (nodesChanged)
      setNodes((current) =>
        current.map((node) =>
          attributeIds.has(node.id) ? { ...node, hidden: hide } : node,
        ),
      );

    if (edgesChanged)
      setEdges((current) =>
        current.map((edge) =>
          touchesAttribute(edge) ? { ...edge, hidden: hide } : edge,
        ),
      );
  }, [
    fingerprint,
    nodesMeasured,
    showAttributes,
    getNodes,
    getEdges,
    setNodes,
    setEdges,
  ]);

  return { onNodeMouseEnter, onNodeMouseLeave, hoveredOwnerId };
};
