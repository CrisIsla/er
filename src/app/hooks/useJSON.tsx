import { useMonaco } from "@monaco-editor/react";
import { Edge, Node, useReactFlow } from "reactflow";
import { ErDocChangeEvent } from "../types/CodeEditor";
import { readNodeSize } from "../util/nodeSize";
import * as Y from "yjs";

export type ErJSON = {
  erDoc: string;

  nodes: {
    id: string;
    position: {
      x: number;
      y: number;
    };
    /**
     * The box this node was stored at, for the nodes that carry an authored
     * size -- today, aggregation containers. Absent means "no stored size", the
     * shape of every file written before this field existed and of all five
     * bundled examples; the reader then falls back to the generator's default.
     */
    width?: number;
    height?: number;
  }[];

  edges: {
    id: string;
    source: string;
    target: string;
  }[];
};

/**
 * The saved form of a node: where it is, and how big if somebody chose that.
 *
 * Reads the size through `readNodeSize` rather than off `node.width/height`, so
 * React Flow's measurement of every label-sized entity stays out of the file --
 * writing it in would freeze those boxes on the next import.
 */
export const toErJSONNodes = (nodes: Node[]): ErJSON["nodes"] =>
  nodes.map((node) => {
    const size = readNodeSize(node);
    return { id: node.id, position: node.position, ...(size ?? {}) };
  });

export const toErJSONEdges = (edges: Edge[]): ErJSON["edges"] =>
  edges.map((edge) => ({
    id: edge.id,
    source: edge.source,
    target: edge.target,
  }));

const exportObject = (object: any, filename: string) => {
  const contentType = "application/json;charset=utf-8;";
  const a = document.createElement("a");
  a.download = filename;
  a.href =
    "data:" +
    contentType +
    "," +
    encodeURIComponent(JSON.stringify(object, null, 2));
  a.target = "_blank";
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};

export const useJSON = (onErDocChange: (evt: ErDocChangeEvent) => void) => {
  const { getNodes, getEdges } = useReactFlow();
  const monaco = useMonaco();

  const exportToJSON = () => {
    const filename = "er-diagram.json";
    const nodes = toErJSONNodes(getNodes());
    const edges = toErJSONEdges(getEdges());
    const editorValue = monaco?.editor.getModels()[0].getValue();

    const json: ErJSON = {
      erDoc: editorValue!,
      nodes,
      edges,
    };

    exportObject(json, filename);
  };

  const importJSON = (
    json: ErJSON,
    monacoInstance?: ReturnType<typeof useMonaco>,
  ) => {
    const editorText = json.erDoc;
    setModelValue(monacoInstance ?? monaco, editorText);
    onErDocChange({
      type: "json",
      positions: {
        nodes: json.nodes,
        edges: json.edges,
      },
    });
  };

  const importJSONColaborative = (json: ErJSON, ydoc: Y.Doc) => {
    const editorText = json.erDoc;

    const yText = ydoc.getText("monaco");

    if (yText.toString().length === 0) {
      yText.delete(0, yText.length);
      yText.insert(0, editorText);
    }

    onErDocChange({
      type: "json",
      positions: {
        nodes: json.nodes,
        edges: json.edges,
      },
    });
  };

  return { exportToJSON, importJSON, importJSONColaborative };
};

const setModelValue = (
  monacoInstance: ReturnType<typeof useMonaco>,
  editorText: string,
) => {
  const model = monacoInstance?.editor.getModels()[0];
  if (!model) return;
  model.pushEditOperations(
    [],
    [
      {
        range: model.getFullModelRange(),
        text: editorText,
      },
    ],
    () => null,
  );
};
