import { useCallback, useEffect, useMemo, useState } from "react";
import ReactFlow, {
  Background,
  BackgroundVariant,
  Edge,
  NodeDragHandler,
  OnInit,
  Panel,
  useEdgesState,
  useNodesState,
  useReactFlow,
} from "reactflow";
import "reactflow/dist/style.css";
import { ER } from "../../../ERDoc/types/parser/ER";
import { AggregationNode, ErNode } from "../../types/ErDiagram";
import { NotationTypes, notations } from "../../util/common";
import { erToReactflowElements } from "../../util/erToReactflowElements";
import { ConfigPanel } from "./ConfigPanel";
import { ControlPanel } from "./ControlPanel";
import EdgeCustomSVGs from "./EdgeCustomSVGs";
import AlignmentGuides from "./AlignmentGuides";
import { useAlignmentGuide } from "../../hooks/useAlignmentGuide";
import { useAttributeVisibility } from "../../hooks/useAttributeVisibility";
import { useDiagramToLocalStorage } from "../../hooks/useDiagramToLocalStorage";
import { useDiagramSettings } from "../../hooks/useDiagramSettings";
import { isAttributeNode } from "../../util/erGraph";
import ErNotation from "./notations/DefaultNotation";
import { useTranslations } from "next-intl";
import { DiagramChange } from "../../types/CodeEditor";
import { useParams } from "next/navigation";
import debounce from "lodash/debounce";
import * as Y from "yjs";

type ErDiagramProps = {
  erDoc: ER;
  erDocHasError: boolean;
  notation: ErNotation;
  notationType: NotationTypes;
  lastChange: DiagramChange | null;
  setEdgesOrthogonal: (isOrthogonal: boolean) => void;
  onNotationChange: (newNotationType: NotationTypes) => void;
  erEdgeNotation: ErNotation["edgeMarkers"];
  ydoc: Y.Doc;
  yNodesMap: Y.Map<ErNode>;
  yEdgesMap: Y.Map<Edge>;
};

const NotationSelectorErDiagramWrapper = ({
  erDoc,
  erDocHasError,
  lastChange,
  ydoc,
  yNodesMap,
  yEdgesMap,
}: {
  erDoc: ER;
  lastChange: DiagramChange | null;
  erDocHasError: boolean;
  ydoc: Y.Doc;
  yNodesMap: Y.Map<ErNode>;
  yEdgesMap: Y.Map<Edge>;
}) => {
  const [edgesOrthogonal, setEdgesOrthogonal] = useState<boolean>(false);
  const [notationType, setNotationType] = useState<NotationTypes>("arrow");
  const notation = useMemo(
    () => new notations[notationType](edgesOrthogonal),
    [notationType, edgesOrthogonal],
  );

  return (
    <ErDiagram
      erDoc={erDoc}
      erDocHasError={erDocHasError}
      notation={notation}
      lastChange={lastChange}
      erEdgeNotation={notation.edgeMarkers}
      notationType={notationType}
      onNotationChange={(newNotationType) => setNotationType(newNotationType)}
      setEdgesOrthogonal={setEdgesOrthogonal}
      ydoc={ydoc}
      yNodesMap={yNodesMap}
      yEdgesMap={yEdgesMap}
    />
  );
};

const ErDiagram = ({
  erDoc,
  erDocHasError,
  notation,
  notationType,
  lastChange,
  onNotationChange,
  setEdgesOrthogonal,
  ydoc,
  yNodesMap,
  yEdgesMap,
}: ErDiagramProps) => {
  const t = useTranslations("home.erDiagram");
  const erNodeTypes = useMemo(() => notation.nodeTypes, [notation]);
  const erEdgeTypes = useMemo(() => notation.edgeTypes, [notation]);
  const erEdgeNotation = useMemo(() => notation.edgeMarkers, [notation]);

  const [prevErDoc, setPrevErDoc] = useState<ER | null>(null);
  const [nodes, setNodes, onNodesChange] = useNodesState<ErNode["data"]>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState([]);

  const { fitView } = useReactFlow();

  const { onNodeDrag, onNodeDragStart, onNodeDragStop, guides } =
    useAlignmentGuide();
  const { saveToLocalStorage, setRfInstance } = useDiagramToLocalStorage();
  const { getNodes, getEdges } = useReactFlow();
  const { onNodeMouseEnter, onNodeMouseLeave } = useAttributeVisibility();
  const { settings } = useDiagramSettings();

  // the rebuild below drops the `hidden` flag useAttributeVisibility sets, and
  // that hook can only restore it a frame later, once every node is measured --
  // so decide it here and never draw the attributes at all
  const attributesStartHidden =
    !settings.showAttributes || settings.attributeMode === "hover";
  const params = useParams();
  const modelId = params.modelId as string;

  useEffect(() => {
    const updateNodes = () => {
      const allNodes = Array.from(yNodesMap.values());
      setNodes(allNodes);
    };
    const updateEdges = () => {
      const allEdges = Array.from(yEdgesMap.values());
      setEdges(allEdges);
    };
    yNodesMap.observe(updateNodes);
    yEdgesMap.observe(updateEdges);
    updateNodes();
    updateEdges();

    return () => {
      yNodesMap.unobserve(updateNodes);
      yEdgesMap.unobserve(updateEdges);
    };
  }, []);

  const syncYMapWithNodes = (nodes: ErNode[]) => {
    ydoc.transact(() => {
      const currentKeys = new Set(yNodesMap.keys());
      const newKeys = new Set(nodes.map((n) => n.id));

      nodes.forEach((node) => {
        const existing = yNodesMap.get(node.id);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(node)) {
          yNodesMap.set(node.id, node);
        }
      });

      currentKeys.forEach((key) => {
        if (!newKeys.has(key)) {
          yNodesMap.delete(key);
        }
      });
    });
  };

  const syncYMapWithEdges = (edges: Edge[]) => {
    ydoc.transact(() => {
      const currentKeys = new Set(yEdgesMap.keys());
      const newKeys = new Set(edges.map((n) => n.id));

      edges.forEach((edge) => {
        const existing = yEdgesMap.get(edge.id);
        if (!existing || JSON.stringify(existing) !== JSON.stringify(edge)) {
          yEdgesMap.set(edge.id, edge);
        }
      });

      currentKeys.forEach((key) => {
        if (!newKeys.has(key)) {
          yEdgesMap.delete(key);
        }
      });
    });
  };

  /**
   * Positions that arrived with an example or an imported file, held until they
   * have actually landed on the nodes -- the ERdoc rebuild below can run after
   * they arrive and would otherwise leave the diagram on erToReactflowElements'
   * seed positions. Same reasoning as ErDiagram.tsx.
   */
  const [pendingPositions, setPendingPositions] = useState<
    { id: string; position: { x: number; y: number } }[] | null
  >(null);

  /**
   * The same positions, readable during render, so the rebuild below can create
   * its nodes where they belong instead of painting them once at the seed
   * positions and correcting them from an effect. Same reasoning as
   * ErDiagram.tsx.
   */
  const incomingPositions = useMemo(() => {
    if (lastChange?.type !== "json" && lastChange?.type !== "localStorage")
      return null;
    return new Map(
      lastChange.positions.nodes.map((node) => [node.id, node.position]),
    );
  }, [lastChange]);

  useEffect(() => {
    if (lastChange?.type === "json" || lastChange?.type === "localStorage")
      setPendingPositions(lastChange.positions.nodes);
  }, [lastChange]);

  useEffect(() => {
    if (pendingPositions === null || nodes.length === 0) return;
    const saved = new Map(
      pendingPositions.map((node) => [node.id, node.position]),
    );

    const settled = nodes.every((node) => {
      const position = saved.get(node.id);
      return (
        position === undefined ||
        (node.position.x === position.x && node.position.y === position.y)
      );
    });

    if (settled) {
      setPendingPositions(null);
      setTimeout(() => window.requestAnimationFrame(() => fitView()), 10);
      return;
    }

    setNodes((current) => {
      const updatedNodes = current.map((node) => {
        const position = saved.get(node.id);
        return position === undefined ? node : { ...node, position };
      });
      syncYMapWithNodes(updatedNodes as ErNode[]);
      return updatedNodes;
    });
    // syncYMapWithNodes is redefined every render; adding it here would make
    // this effect fire on every render instead of when the positions change
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingPositions, nodes, setNodes, fitView]);

  if (!erDocHasError && erDoc !== prevErDoc) {
    setPrevErDoc(erDoc);
    const [fromErNodes, fromErEdges] = erToReactflowElements(
      erDoc,
      erEdgeNotation,
    );
    const attributeIds = new Set(
      fromErNodes.filter(isAttributeNode).map((node) => node.id),
    );
    const renaming =
      nodes.length === fromErNodes.length &&
      edges.length === fromErEdges.length;
    // @ts-ignore
    setNodes((nodes) => {
      const alreadyExists: string[] = [];
      const updatedNodes = nodes
        // if the node already exists, keep its position
        .map((oldNode) => {
          let newNode = fromErNodes.find(
            (newNode) => newNode.data.erId === oldNode.data.erId,
          );
          if (!newNode && renaming) {
            newNode = fromErNodes.find((newNode) => newNode.id === oldNode.id);
          }
          if (newNode) {
            alreadyExists.push(newNode.id);
            newNode.position =
              incomingPositions?.get(newNode.id) ?? oldNode.position;
            if (attributeIds.has(newNode.id))
              newNode.hidden = attributesStartHidden;
            // for aggregations, don't modify its size
            if (newNode.type === "aggregation") {
              newNode.data.height = (oldNode as AggregationNode).data.height;
              newNode.data.width = (oldNode as AggregationNode).data.width;
            }
            return newNode;
          }
          return undefined;
        })
        .filter((n): n is ErNode => n !== undefined)
        // hide the new nodes and add them
        .concat(
          fromErNodes
            .filter((nn) => !alreadyExists.includes(nn.id))
            .map((newNode) => ({
              ...newNode,
              position: incomingPositions?.get(newNode.id) ?? newNode.position,
              hidden: attributeIds.has(newNode.id)
                ? attributesStartHidden
                : newNode.hidden,
              style: { ...newNode.style, opacity: 1 },
            })),
        );
      syncYMapWithNodes(updatedNodes);
      return updatedNodes;
    });

    setEdges((oldEdges) => {
      const alreadyExists: string[] = [];
      const updatedEdges = oldEdges
        .map((oldEdge) => {
          const updatedEdge = fromErEdges.find((ne) => ne.id === oldEdge.id);
          if (updatedEdge) alreadyExists.push(updatedEdge.id);
          return updatedEdge;
        })
        .concat(
          fromErEdges
            .filter((ne) => !alreadyExists.includes(ne.id))
            .map((e) => ({
              ...e,
              hidden:
                attributesStartHidden &&
                (attributeIds.has(e.source) || attributeIds.has(e.target)),
            })),
        )
        .filter((e) => e !== undefined) as Edge[];
      syncYMapWithEdges(updatedEdges);
      return updatedEdges;
    });
  }

  useEffect(() => {
    setTimeout(() => window.requestAnimationFrame(() => fitView()), 10);
  }, [nodes.length, fitView]);

  // add defs to viewport so they appear when exporting to image
  const handleInit: OnInit = useCallback(
    (rf) => {
      setRfInstance(rf);
      const viewport = document.querySelector(".react-flow__viewport")!;
      const defs = document.querySelector("#defs")!;
      viewport.append(defs);
    },
    [setRfInstance],
  );

  const onNodeDragStartHandler: NodeDragHandler = (e, node, nodes) => {
    onNodeDragStart(e, node, nodes);
  };

  const onNodeDragStopHandler: NodeDragHandler = (e, node, nodes) => {
    ydoc.transact(() => {
      const existing = yNodesMap.get(node.id);
      if (existing) {
        yNodesMap.set(node.id, {
          ...existing,
          position: node.position,
        });
      }
    });
    onNodeDragStop(e, node, nodes);
  };

  const debouncedSaveDiagram = useMemo(
    () =>
      debounce(async (nodesJSON: any, edgesJSON: any) => {
        await fetch(`/api/diagram/${modelId}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            json: { nodesJSON, edgesJSON },
            source: "diagram",
          }),
        });
      }, 5000),
    [modelId],
  );

  useEffect(() => {
    if (nodes.length === 0 && edges.length === 0) return;
    const nodesJSON = getNodes().map((node) => ({
      id: node.id,
      position: node.position,
    }));

    const edgesJSON = getEdges().map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    }));
    debouncedSaveDiagram(nodesJSON, edgesJSON);
  }, [nodes, edges, debouncedSaveDiagram]);

  return (
    <ReactFlow
      onInit={handleInit}
      nodes={nodes}
      onNodesChange={onNodesChange}
      nodeTypes={erNodeTypes}
      edges={edges}
      onEdgesChange={onEdgesChange}
      edgeTypes={erEdgeTypes}
      onNodeDrag={onNodeDrag}
      onNodeDragStart={onNodeDragStartHandler}
      onNodeDragStop={onNodeDragStopHandler}
      onNodeMouseEnter={onNodeMouseEnter}
      onNodeMouseLeave={onNodeMouseLeave}
      proOptions={{ hideAttribution: true }}
    >
      <Background
        id="1"
        gap={10}
        color="#f1f1f1"
        variant={BackgroundVariant.Lines}
      />
      <Background
        id="2"
        gap={100}
        offset={1}
        color="#e3e1e1"
        variant={BackgroundVariant.Lines}
      />

      <Panel position="top-left">
        {erDocHasError && (
          <div className="absolute w-52 rounded border-2 border-red-950 bg-red-800 p-1 text-slate-200">
            <p>{t("fixErrorsToSync")}</p>
          </div>
        )}
      </Panel>

      <Panel position="top-right">
        <ConfigPanel
          notationType={notationType}
          setEdgesOrthogonal={setEdgesOrthogonal}
          onNotationChange={onNotationChange}
        />
      </Panel>
      <EdgeCustomSVGs />
      <AlignmentGuides guides={guides} />
      <ControlPanel onLayoutClick={saveToLocalStorage} />
    </ReactFlow>
  );
};

export { NotationSelectorErDiagramWrapper as ErDiagram };
