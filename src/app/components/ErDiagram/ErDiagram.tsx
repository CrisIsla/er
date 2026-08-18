import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type ErDiagramProps = {
  erDoc: ER;
  erDocHasError: boolean;
  notation: ErNotation;
  notationType: NotationTypes;
  lastChange: DiagramChange | null;
  setEdgesOrthogonal: (isOrthogonal: boolean) => void;
  onNotationChange: (newNotationType: NotationTypes) => void;
  erEdgeNotation: ErNotation["edgeMarkers"];
};

const NotationSelectorErDiagramWrapper = ({
  erDoc,
  erDocHasError,
  lastChange,
}: {
  erDoc: ER;
  lastChange: DiagramChange | null;
  erDocHasError: boolean;
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
  const { saveToLocalStorage, loadFromLocalStorage, setRfInstance } =
    useDiagramToLocalStorage();
  const { onNodeMouseEnter, onNodeMouseLeave } = useAttributeVisibility();
  const { settings } = useDiagramSettings();

  /**
   * Whether an attribute should be born hidden.
   *
   * The rebuild below constructs brand-new nodes from the AST, which drops the
   * `hidden` flag useAttributeVisibility puts on them; that hook can only put it
   * back once React Flow has measured every node, a frame later. Deciding it here
   * means the attributes are never drawn in the first place.
   */
  const attributesStartHidden =
    !settings.showAttributes || settings.attributeMode === "hover";

  /**
   * Hides the nodes and edges -- not the grid -- until the view has been fitted.
   *
   * fitView needs measured nodes, so it cannot run until after a paint. Without
   * this the freshly loaded diagram is drawn once at the previous example's pan
   * and zoom, and then snaps into place.
   */
  const [hideUntilFit, setHideUntilFit] = useState(false);

  /**
   * Positions that arrived with an example or an imported file.
   *
   * They are held until they have actually landed on the nodes. Applying them
   * once is not enough: the ERdoc rebuild below runs whenever the parsed
   * document changes, which for an example load happens *after* the positions
   * arrive, and it creates its nodes at erToReactflowElements' seed positions --
   * the two bare columns. Keeping them pending until the diagram agrees with
   * them makes the stored layout win regardless of which lands first.
   */
  const [pendingPositions, setPendingPositions] = useState<
    { id: string; position: { x: number; y: number } }[] | null
  >(null);

  /**
   * The same positions, as a lookup usable during render.
   *
   * The rebuild below runs in the render phase, while pendingPositions is
   * applied from an effect -- and effects run after the browser has painted. So
   * without this the newly built nodes get painted once at the generator's seed
   * positions before being corrected, which reads as a flash of the wrong
   * layout. Reading the incoming positions here lets the nodes be created where
   * they belong, and the effect stays as the fallback for the case where the
   * rebuild happens before the positions arrive.
   */
  const incomingPositions = useMemo(() => {
    if (lastChange?.type !== "json" && lastChange?.type !== "localStorage")
      return null;
    return new Map(
      lastChange.positions.nodes.map((node) => [node.id, node.position]),
    );
  }, [lastChange]);
  const hasPendingPositions = useRef(false);
  hasPendingPositions.current = pendingPositions !== null;

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
      setTimeout(
        () =>
          window.requestAnimationFrame(() => {
            fitView();
            setHideUntilFit(false);
          }),
        10,
      );
      setTimeout(saveToLocalStorage, 100);
      return;
    }

    setNodes((current) =>
      current.map((node) => {
        const position = saved.get(node.id);
        return position === undefined ? node : { ...node, position };
      }),
    );
  }, [pendingPositions, nodes, setNodes, saveToLocalStorage, fitView]);

  if (!erDocHasError && erDoc !== prevErDoc) {
    setPrevErDoc(erDoc);
    const [fromErNodes, fromErEdges] = erToReactflowElements(
      erDoc,
      erEdgeNotation,
    );
    // an example or an imported file brings its own layout, so the view will be
    // refitted; keep it covered until then
    if (incomingPositions !== null) setHideUntilFit(true);
    const attributeIds = new Set(
      fromErNodes.filter(isAttributeNode).map((node) => node.id),
    );
    const renaming =
      nodes.length === fromErNodes.length &&
      edges.length === fromErEdges.length;
    // @ts-ignore
    setNodes((nodes) => {
      const alreadyExists: string[] = [];
      return (
        nodes
          // if the node already exists, keep its position
          .map((oldNode) => {
            let newNode = fromErNodes.find(
              (newNode) => newNode.data.erId === oldNode.data.erId,
            );
            if (!newNode && renaming) {
              newNode = fromErNodes.find(
                (newNode) => newNode.id === oldNode.id,
              );
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
          .filter((n) => n !== undefined)
          // hide the new nodes and add them
          .concat(
            fromErNodes
              .filter((nn) => !alreadyExists.includes(nn.id))
              .map((newNode) => ({
                ...newNode,
                position:
                  incomingPositions?.get(newNode.id) ?? newNode.position,
                hidden: attributeIds.has(newNode.id)
                  ? attributesStartHidden
                  : newNode.hidden,
                style: { ...newNode.style, opacity: 1 },
              })),
          )
      );
    });

    const edgeStartsHidden = (edge: Edge) =>
      attributesStartHidden &&
      (attributeIds.has(edge.source) || attributeIds.has(edge.target));

    setEdges((oldEdges) => {
      const alreadyExists: string[] = [];
      return oldEdges
        .map((oldEdge) => {
          const updatedEdge = fromErEdges.find((ne) => ne.id === oldEdge.id);
          if (updatedEdge) alreadyExists.push(updatedEdge.id);
          return updatedEdge;
        })
        .concat(fromErEdges.filter((ne) => !alreadyExists.includes(ne.id)))
        .filter((e) => e !== undefined)
        .map((e) => ({ ...e!, hidden: edgeStartsHidden(e!) })) as Edge[];
    });
    setTimeout(saveToLocalStorage, 100);
  }

  useEffect(() => {
    setTimeout(() => window.requestAnimationFrame(() => fitView()), 10);
  }, [nodes.length, fitView]);

  // The cover above is only ever meant to last a couple of frames. If the
  // positions never settle -- ids that do not line up, a diagram that fails to
  // build -- this makes sure the user is not left staring at an empty pane.
  useEffect(() => {
    if (!hideUntilFit) return;
    const timer = setTimeout(() => setHideUntilFit(false), 1000);
    return () => clearTimeout(timer);
  }, [hideUntilFit]);

  // add defs to viewport so they appear when exporting to image
  const handleInit: OnInit = useCallback(
    (rf) => {
      setRfInstance(rf);
      const viewport = document.querySelector(".react-flow__viewport")!;
      const defs = document.querySelector("#defs")!;
      viewport.append(defs);
      // on mount, load from local storage -- unless an example is already on its
      // way in, whose positions would otherwise be overwritten by the last
      // session's diagram
      if (!hasPendingPositions.current) loadFromLocalStorage();
    },
    [setRfInstance, loadFromLocalStorage],
  );

  const onNodeDragStartHandler: NodeDragHandler = (e, node, nodes) => {
    saveToLocalStorage();
    onNodeDragStart(e, node, nodes);
  };

  const onNodeDragStopHandler: NodeDragHandler = (e, node, nodes) => {
    saveToLocalStorage();
    onNodeDragStop(e, node, nodes);
  };

  return (
    <ReactFlow
      className={hideUntilFit ? "diagram-awaiting-fit" : undefined}
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
