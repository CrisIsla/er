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
import { ErNode } from "../../types/ErDiagram";
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
import { incomingLayout, mergeRebuiltNodes } from "../../util/rebuildNodes";
import { useResizeCommit } from "../../hooks/useResizeCommit";
import { useAggregationAutoGrow } from "../../hooks/useAggregationAutoGrow";
import { ErJSON, toErJSONEdges, toErJSONNodes } from "../../hooks/useJSON";
import { isFiniteSize, readNodeSize, withNodeSize } from "../../util/nodeSize";
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
   * The layout that arrived with an example or an imported file, held until it
   * has actually landed on the nodes -- the ERdoc rebuild below can run after
   * it arrives and would otherwise leave the diagram on erToReactflowElements'
   * seed positions. Same reasoning as ErDiagram.tsx.
   *
   * It carries sizes as well as positions, and that matters more here than it
   * does solo: importJSONColaborative never touches yNodesMap, so the
   * syncYMapWithNodes below is the only route a size loaded from the server has
   * into the shared document.
   */
  const [pendingLayout, setPendingLayout] = useState<ErJSON["nodes"] | null>(
    null,
  );

  /**
   * The same layout, readable during render, so the rebuild below can create
   * its nodes where they belong instead of painting them once at the seed
   * positions and correcting them from an effect. Same reasoning as
   * ErDiagram.tsx.
   */
  const incoming = useMemo(
    () =>
      lastChange?.type === "json" || lastChange?.type === "localStorage"
        ? incomingLayout(lastChange.positions.nodes)
        : null,
    [lastChange],
  );

  useEffect(() => {
    if (lastChange?.type === "json" || lastChange?.type === "localStorage")
      setPendingLayout(lastChange.positions.nodes);
  }, [lastChange]);

  useEffect(() => {
    if (pendingLayout === null || nodes.length === 0) return;
    const saved = new Map(pendingLayout.map((node) => [node.id, node]));

    const settled = nodes.every((node) => {
      const record = saved.get(node.id);
      if (record === undefined) return true;
      if (
        node.position.x !== record.position.x ||
        node.position.y !== record.position.y
      )
        return false;
      if (!isFiniteSize(record.width, record.height)) return true;
      const size = readNodeSize(node);
      return (
        size !== null &&
        size.width === record.width &&
        size.height === record.height
      );
    });

    if (settled) {
      setPendingLayout(null);
      setTimeout(() => window.requestAnimationFrame(() => fitView()), 10);
      return;
    }

    setNodes((current) => {
      const updatedNodes = current.map((node) => {
        const record = saved.get(node.id);
        if (record === undefined) return node;
        const moved = { ...node, position: record.position };
        return isFiniteSize(record.width, record.height)
          ? withNodeSize(moved, {
              width: record.width!,
              height: record.height!,
            })
          : moved;
      });
      syncYMapWithNodes(updatedNodes as ErNode[]);
      return updatedNodes;
    });
    // syncYMapWithNodes is redefined every render; adding it here would make
    // this effect fire on every render instead of when the layout changes
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingLayout, nodes, setNodes, fitView]);

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
      const updatedNodes = mergeRebuiltNodes({
        oldNodes: nodes as ErNode[],
        newNodes: fromErNodes,
        incoming,
        attributeIds,
        attributesStartHidden,
        renaming,
      });
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

  /**
   * Publishing after a resize goes through the whole-node sync rather than a
   * targeted write on the container: the drag moved the members too, and the
   * yjs observer replaces the local node array wholesale, so publishing only
   * the container would pull the members back to their last synced positions.
   *
   * Deferred by a frame because this fires before the store has flushed.
   */
  const publishAfterFlush = () =>
    setTimeout(
      () =>
        window.requestAnimationFrame(() =>
          syncYMapWithNodes(getNodes() as ErNode[]),
        ),
      0,
    );

  const onNodesChangeWithResize = useResizeCommit(
    onNodesChange,
    publishAfterFlush,
  );

  useAggregationAutoGrow({
    enabled: pendingLayout === null,
    onGrown: (grownNodes) => syncYMapWithNodes(grownNodes as ErNode[]),
  });

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
    debouncedSaveDiagram(toErJSONNodes(getNodes()), toErJSONEdges(getEdges()));
  }, [nodes, edges, debouncedSaveDiagram]);

  return (
    <ReactFlow
      onInit={handleInit}
      nodes={nodes}
      onNodesChange={onNodesChangeWithResize}
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
