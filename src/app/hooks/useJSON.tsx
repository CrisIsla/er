import { useMonaco } from "@monaco-editor/react";
import { useReactFlow } from "reactflow";
import { ErDocChangeEvent } from "../types/CodeEditor";
import * as Y from "yjs";

export type ErJSON = {
  erDoc: string;

  nodes: {
    id: string;
    position: {
      x: number;
      y: number;
    };
  }[];

  edges: {
    id: string;
    source: string;
    target: string;
  }[];
};

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
    // save only ids and positions
    const nodes = getNodes().map((node) => ({
      id: node.id,
      position: node.position,
    }));

    const edges = getEdges().map((edge) => ({
      id: edge.id,
      source: edge.source,
      target: edge.target,
    }));
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
