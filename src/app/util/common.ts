import { Node } from "reactflow";
import { Relationship } from "../../ERDoc/types/parser/Relationship";
import ArrowNotation from "../components/ErDiagram/notations/ArrowNotation/ArrowNotation";
import MinMaxNotation from "../components/ErDiagram/notations/MinMaxNotation/MinMaxNotation";
import { toSvg } from "html-to-image";
import ChenNotation from "../components/ErDiagram/notations/ChenNotation/ChenNotation";
import { ER } from "../../ERDoc/types/parser/ER";
import { ErJSON } from "../hooks/useJSON";

export const createRelationshipId = (relationship: Relationship): string => {
  // relationships are identified by their name and attributes, so we need all this info to generate a unique ID.
  return `${relationship.name}$${relationship.participantEntities
    .map((part) => part.entityName)
    .sort()
    .join("$")}`;
};

export const createEntityNodeId = (entityName: string): string => {
  return `entity: ${entityName}`;
};

export const createRelationshipNodeId = (relationshipId: string): string => {
  return `relationship: ${relationshipId}`;
};

export type LayoutedNode = Node & { x: number; y: number };

export const updateNodePosition = (
  node: LayoutedNode,
  nodes: LayoutedNode[],
  adjustAnchor: boolean = false,
): LayoutedNode => {
  if (adjustAnchor) {
    node.x -= node.width! / 2;
    node.y -= node.height! / 2;
  }
  const parentNode = nodes.find((n) => n.id === node.parentNode);
  if (parentNode) {
    node.x = node.x - parentNode.x;
    node.y = node.y - parentNode.y;
  }
  return { ...node, position: { x: node.x, y: node.y } };
};

const HANDLE_PREFIXES = ["1", "2", "3", "4"] as const;
export const getHandlePrefix = (edgeId: string) => {
  let handlePrefix = "";
  if (HANDLE_PREFIXES.find((prefix) => prefix === edgeId[0])) {
    handlePrefix = edgeId[0];
  }
  return handlePrefix;
};

export const notations = {
  arrow: ArrowNotation,
  minmax: MinMaxNotation,
  chen: ChenNotation,
};

export type NotationTypes = keyof typeof notations;

export type DownloadFunc = (
  w: number,
  h: number,
  transparentBg: boolean,
) => void;

/**
 * Marks an element as an annotation rather than part of the diagram.
 *
 * Both export paths capture an ancestor of the edge-label portal -- the image
 * one takes `.react-flow__renderer`, the print one `.react-flow__viewport` --
 * so anything drawn through that portal is in the exported file unless it says
 * otherwise. The guides get away with it by only existing during a drag; a mark
 * that is always on would not.
 */
export const EXPORT_EXCLUDED_CLASS = "er-overlay-annotation";

/**
 * html-to-image's filter, which it runs over *every* node it walks, including
 * text nodes -- and `Text` has no `classList`, so this has to tolerate its
 * absence rather than assume an element.
 */
export const isExportable = (node: HTMLElement) =>
  (node as Element).classList?.contains(EXPORT_EXCLUDED_CLASS) !== true;

/**
 * Set on the page while the diagram is being captured, for what is only drawn
 * for the person editing it but cannot be left out by `isExportable`, because
 * it is a style on a node rather than an element of its own -- the selection
 * highlight (see globals.css). html-to-image writes every element's computed
 * style into the file, so the style has to be off while it reads them.
 */
export const EXPORTING_CLASS = "er-exporting";

export const capturingForExport = async <T>(
  capture: () => Promise<T>,
): Promise<T> => {
  document.documentElement.classList.add(EXPORTING_CLASS);
  try {
    return await capture();
  } finally {
    document.documentElement.classList.remove(EXPORTING_CLASS);
  }
};

export const downloadImage = (dataUrl: string, fileExtension: string) => {
  const a = document.createElement("a");
  a.setAttribute("download", `er_diagram.${fileExtension}`);
  a.setAttribute("href", dataUrl);
  a.click();
};

export const exportToPDF = async (width: number, height: number) => {
  // Get the DOM element
  const flow = document.querySelector<HTMLElement>(".react-flow__viewport");
  // Convert to SVG
  const svgContent = await capturingForExport(() =>
    toSvg(flow!, { filter: isExportable }),
  );
  const svgElement = decodeURIComponent(
    svgContent.replace("data:image/svg+xml;charset=utf-8,", "").trim(),
  );
  // Open new window
  const newWindow = open();
  // Write our page content to the newly opened page
  newWindow?.document.write(
    `<html>
                    <head>
                        <title>ER Diagram</title>
                        <style type="text/css" media="print">
                          @page { size: landscape; }
                        </style>
                        <style>
                            body {
                                width: ${width.toString()} px;
                                height: ${height.toString()} px;
                                margin: auto
                            }
                            .container {
                                 background: #393D43;
                                text-align: center;
                                height: 100%;
                                 width: 100%;
                            }
                            
                            @page {
                                margin:0 !important;
                            }
                            @media print {

                                * {
                                    -webkit-print-color-adjust: exact !important;
                                    color-adjust: exact !important;
                                }
                                .container {
                                    background: none;
                                }
                            }
                        </style>
                    </head>
                    <body>
                        <div class='container'>
                            <div class='svg-container'>
                                ${svgElement}
                            </div>
                            
                            <script>
                                document.close();
                                window.print();
                            </script>
                        </div>
                    </body>
                </html>`,
  );
};

export const erDocWithoutLocation = (erDoc: ER) => {
  return {
    entities: erDoc.entities.map((entity) => ({
      ...entity,
      attributes: entity.attributes.map((attr) => ({
        ...attr,
        location: undefined,
      })),
      location: undefined,
    })),

    relationships: erDoc.relationships.map((relationship) => ({
      ...relationship,
      location: undefined,
      attributes: relationship.attributes.map((attr) => ({
        ...attr,
        location: undefined,
      })),
      participantEntities: relationship.participantEntities.map((part) => ({
        ...part,
        location: undefined,
      })),
    })),

    aggregations: erDoc.aggregations.map((agg) => ({
      ...agg,
      location: undefined,
    })),
  };
};

export const fetchExample = async (exampleName: string) => {
  const res = await fetch(`/api/examples/${exampleName}`);
  // if res is 404, then the example doesn't exist
  if (res.status === 404) {
    return null;
  } else {
    const data: { example: ErJSON } = await (res.json() as Promise<{
      example: ErJSON;
    }>);
    return data.example;
  }
};
