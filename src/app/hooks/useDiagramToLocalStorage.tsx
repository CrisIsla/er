import { useCallback, useState } from "react";
import { ReactFlowInstance, useReactFlow } from "reactflow";

const LOCAL_STORAGE_FLOW_KEY = "er-flow";

/**
 * Saves the diagram from anywhere inside the React Flow provider.
 *
 * useDiagramToLocalStorage keeps the instance in its own state, so only the
 * component that called setRfInstance can save through it. `toObject` comes off
 * the shared store instead, which is what lets the header's layout button
 * persist the positions it just produced.
 */
export const useSaveFlow = () => {
  const { toObject } = useReactFlow();
  return useCallback(() => {
    localStorage.setItem(LOCAL_STORAGE_FLOW_KEY, JSON.stringify(toObject()));
  }, [toObject]);
};

export const useDiagramToLocalStorage = () => {
  const { setNodes, setEdges, setViewport } = useReactFlow();
  const [rfInstance, setRfInstance] = useState<ReactFlowInstance | null>(null);

  const saveToLocalStorage = useCallback(() => {
    if (rfInstance) {
      const flow = rfInstance.toObject();
      localStorage.setItem(LOCAL_STORAGE_FLOW_KEY, JSON.stringify(flow));
    }
  }, [rfInstance]);

  const loadFromLocalStorage = () => {
    const storedFlow = localStorage.getItem(LOCAL_STORAGE_FLOW_KEY);
    if (storedFlow) {
      const flow = JSON.parse(storedFlow);
      const { x = 0, y = 0, zoom = 1 } = flow.viewport;
      setNodes(() => {
        return flow.nodes || [];
      });
      setEdges(flow.edges || []);
      setViewport({ x, y, zoom });
      return true;
    }
    return false;
  };

  return { saveToLocalStorage, loadFromLocalStorage, setRfInstance };
};
