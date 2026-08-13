import { useCallback, useEffect, useState } from "react";
import {
  Edge,
  NodeMouseHandler,
  ReactFlowState,
  useReactFlow,
  useStore,
} from "reactflow";
import { buildOwnerMap, isAttributeNode } from "../util/erGraph";
import { useDiagramSettings } from "./useDiagramSettings";

// true once every node has been measured. We only hide after this, so a node
// can't be stranded without dimensions -- useLayoutedElements refuses to run
// until all nodes report a width and a height.
const nodesMeasuredSelector = (state: ReactFlowState) =>
  Array.from(state.nodeInternals.values()).every(
    (node) => node.width && node.height,
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

/**
 * Keeps attribute nodes (and their edges) in sync with the attribute settings.
 *
 * Uses `hidden` rather than removing the nodes on purpose: hidden nodes stay in
 * `nodeInternals`, so the node count ELK watches doesn't change and the diagram
 * doesn't re-layout every time attributes are toggled.
 *
 * Returns the hover handlers the diagram must pass to <ReactFlow> for the
 * "only on hover" mode to work.
 */
export const useAttributeVisibility = () => {
  const { settings } = useDiagramSettings();
  const { getNodes, getEdges, setNodes, setEdges } = useReactFlow();
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const nodesMeasured = useStore(nodesMeasuredSelector);
  const fingerprint = useStore(visibilityFingerprint);

  const onNodeMouseEnter: NodeMouseHandler = useCallback((_evt, node) => {
    setHoveredId(node.id);
  }, []);

  const onNodeMouseLeave: NodeMouseHandler = useCallback((_evt, node) => {
    // if the pointer already moved onto another node, that enter has landed
    // first and we must not clear it
    setHoveredId((current) => (current === node.id ? null : current));
  }, []);

  const { showAttributes, attributeMode } = settings;

  useEffect(() => {
    if (!nodesMeasured) return;

    const nodes = getNodes();
    const edges = getEdges();
    const { owner, attributeIds } = buildOwnerMap(nodes, edges);
    if (attributeIds.size === 0) return;

    // hovering a revealed attribute counts as hovering its owner, otherwise
    // moving the pointer onto one would hide its siblings out from under it
    const hoveredOwner =
      hoveredId === null ? null : owner.get(hoveredId) ?? hoveredId;

    const shouldHideAttribute = (id: string) => {
      if (!showAttributes) return true;
      if (attributeMode === "always") return false;
      return owner.get(id) !== hoveredOwner;
    };

    const desiredNodeState = new Map<string, boolean>();
    for (const id of attributeIds)
      desiredNodeState.set(id, shouldHideAttribute(id));

    const nodesChanged = nodes.some(
      (node) =>
        desiredNodeState.has(node.id) &&
        Boolean(node.hidden) !== desiredNodeState.get(node.id),
    );
    // an edge follows whichever of its endpoints is an attribute
    const edgeHidden = (edge: Edge) =>
      (attributeIds.has(edge.source) &&
        desiredNodeState.get(edge.source) === true) ||
      (attributeIds.has(edge.target) &&
        desiredNodeState.get(edge.target) === true);
    const edgesChanged = edges.some(
      (edge) =>
        (attributeIds.has(edge.source) || attributeIds.has(edge.target)) &&
        Boolean(edge.hidden) !== edgeHidden(edge),
    );

    // bail when nothing differs, so applying state can't feed back into the
    // fingerprint and loop
    if (!nodesChanged && !edgesChanged) return;

    if (nodesChanged)
      setNodes((current) =>
        current.map((node) =>
          desiredNodeState.has(node.id)
            ? { ...node, hidden: desiredNodeState.get(node.id) }
            : node,
        ),
      );

    if (edgesChanged)
      setEdges((current) =>
        current.map((edge) =>
          attributeIds.has(edge.source) || attributeIds.has(edge.target)
            ? { ...edge, hidden: edgeHidden(edge) }
            : edge,
        ),
      );
  }, [
    fingerprint,
    nodesMeasured,
    hoveredId,
    showAttributes,
    attributeMode,
    getNodes,
    getEdges,
    setNodes,
    setEdges,
  ]);

  return { onNodeMouseEnter, onNodeMouseLeave };
};
