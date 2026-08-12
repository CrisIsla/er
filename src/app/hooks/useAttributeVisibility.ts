import { useCallback, useEffect } from "react";
import { ReactFlowState, useReactFlow, useStore } from "reactflow";
import { useDiagramSettings } from "./useDiagramSettings";

const ATTRIBUTE_NODE_TYPES = [
  "entity-attribute",
  "relationship-attribute",
  "composite-attribute",
];

const isAttributeNode = (node: { type?: string }) =>
  ATTRIBUTE_NODE_TYPES.includes(node.type ?? "");

// true once every node has been measured. We only hide after this, so a node
// can't be stranded without dimensions -- useLayoutedElements refuses to run
// until all nodes report a width and a height.
const nodesMeasuredSelector = (state: ReactFlowState) =>
  Array.from(state.nodeInternals.values()).every(
    (node) => node.width && node.height,
  );

// true when an attribute node, or an edge touching one, doesn't match the
// requested visibility.
//
// Edges are checked as well as nodes because two other pieces of the diagram
// reset visibility behind our back: useLayoutedElements unhides *every* edge
// after a layout pass, and ErDiagram rebuilds nodes from scratch whenever the
// ERdoc changes, dropping the `hidden` flag. Watching both means we re-apply
// instead of leaving edges dangling towards invisible nodes.
const isOutOfSync = (state: ReactFlowState, shouldHide: boolean) => {
  const attributeIds = new Set<string>();
  for (const node of state.nodeInternals.values()) {
    if (!isAttributeNode(node)) continue;
    if (Boolean(node.hidden) !== shouldHide) return true;
    attributeIds.add(node.id);
  }
  if (attributeIds.size === 0) return false;

  for (const edge of state.edges) {
    if (!attributeIds.has(edge.source) && !attributeIds.has(edge.target))
      continue;
    if (Boolean(edge.hidden) !== shouldHide) return true;
  }
  return false;
};

/**
 * Keeps attribute nodes (and their edges) in sync with the `showAttributes`
 * setting.
 *
 * Uses `hidden` rather than removing the nodes on purpose: hidden nodes stay
 * in `nodeInternals`, so the node count ELK watches doesn't change and the
 * diagram doesn't re-layout every time attributes are toggled.
 */
export const useAttributeVisibility = () => {
  const { settings } = useDiagramSettings();
  const shouldHide = !settings.showAttributes;

  const { getNodes, setNodes, setEdges } = useReactFlow();
  const nodesMeasured = useStore(nodesMeasuredSelector);
  const outOfSync = useStore(
    useCallback(
      (state: ReactFlowState) => isOutOfSync(state, shouldHide),
      [shouldHide],
    ),
  );

  useEffect(() => {
    if (!outOfSync || !nodesMeasured) return;

    const attributeIds = new Set(
      getNodes()
        .filter(isAttributeNode)
        .map((node) => node.id),
    );
    if (attributeIds.size === 0) return;

    setNodes((nodes) =>
      nodes.map((node) =>
        attributeIds.has(node.id) ? { ...node, hidden: shouldHide } : node,
      ),
    );

    setEdges((edges) =>
      edges.map((edge) =>
        attributeIds.has(edge.source) || attributeIds.has(edge.target)
          ? { ...edge, hidden: shouldHide }
          : edge,
      ),
    );
  }, [outOfSync, nodesMeasured, shouldHide, getNodes, setNodes, setEdges]);
};
