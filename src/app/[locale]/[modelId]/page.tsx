"use client";
import dynamic from "next/dynamic";
import { useEffect, useRef, useState } from "react";
import { useParams } from "next/navigation";
import Header from "../../components/Header/Header";
import { erDocWithoutLocation } from "../../util/common";
import { DiagramChange, ErDocChangeEvent } from "../../types/CodeEditor";
import { ER } from "../../../ERDoc/types/parser/ER";
import { useJSON } from "../../hooks/useJSON";
import { useMonaco } from "@monaco-editor/react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { debounce } from "lodash";
import * as Y from "yjs";
import { WebsocketProvider } from "y-websocket";
const Body = dynamic(() => import("../../components/BodyColab"), {
  ssr: false,
});

const Page = () => {
  const [erDoc, setErDoc] = useState<ER | null>(null);
  const [lastChange, setLastChange] = useState<DiagramChange | null>(null);

  const monaco = useMonaco();
  const params = useParams();
  const locale = useLocale();
  const router = useRouter();
  const modelId = params.modelId as string;
  const [modelName, setModelName] = useState<string>("");
  const [showJoinModal, setShowJoinModal] = useState(false);
  const saveRef = useRef<(id: string) => void>();
  const ydocRef = useRef<Y.Doc>();
  const providerRef = useRef<WebsocketProvider>();
  const [ydocReady, setYdocReady] = useState(false);

  useEffect(() => {
    if (!monaco) return;
    saveRef.current = debounce((id: string) => {
      const editorModels = monaco.editor.getModels();
      if (!editorModels?.length) return;
      const editorValue = editorModels[0].getValue();
      fetch(`/api/diagram/${id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ json: editorValue, source: "code" }),
      }).catch((err) => console.error("Error saving model:", err));
    }, 5000);
  }, [monaco]);

  const onErDocChange = (evt: ErDocChangeEvent) => {
    switch (evt.type) {
      case "json": {
        setLastChange({
          type: "json",
          positions: evt.positions,
        });
        return;
      }

      case "localStorage": {
        setLastChange({
          type: "localStorage",
          positions: evt.positions,
        });
        return;
      }

      case "userInput": {
        const { er } = evt;
        setErDoc((currentEr) => {
          if (currentEr === null) return er;
          const currentErNoLoc = erDocWithoutLocation(currentEr);
          const newErNoLoc = erDocWithoutLocation(er);
          const sameSemanticValue =
            JSON.stringify(currentErNoLoc) === JSON.stringify(newErNoLoc);
          return sameSemanticValue ? currentEr : er;
        });
        if (modelId) {
          saveRef.current?.(modelId);
        }
        return;
      }

      default: {
        const exhaustiveCheck: never = evt;
        throw new Error(`Unhandled event type: ${exhaustiveCheck}`);
      }
    }
  };

  const { importJSONColaborative } = useJSON(onErDocChange);

  useEffect(() => {
    const ydoc = new Y.Doc();
    ydocRef.current = ydoc;

    const provider = new WebsocketProvider(
      process.env.NEXT_PUBLIC_WS_URL || "ws://localhost:1234",
      modelId,
      ydoc,
    );
    providerRef.current = provider;

    provider.on("status", ({ status }) => {
      console.log("WebSocket status:", status);
    });

    provider.on("sync", async (isSynced: boolean) => {
      if (!isSynced) return;

      const res = await fetch(`/api/diagram/${modelId}`, {
        credentials: "include",
      });
      if (res.status === 401) {
        router.push(`/${locale}/login`);
        return;
      }
      if (res.status === 500) {
        router.push(`/${locale}`);
        return;
      }
      const data = await res.json();
      if (!data.isAuthorized) {
        setShowJoinModal(true);
        return;
      }

      setModelName(data.model.name);

      const yText = ydoc.getText("monaco");
      const yNodesMap = ydoc.getMap("nodesMap");
      const yEdgesMap = ydoc.getMap("edgesMap");

      if (yText.length === 0) {
        yText.insert(0, data.model.json.erDoc);
      }
      importJSONColaborative(data.model.json, ydoc);
    });

    setYdocReady(true);

    return () => {
      provider.destroy();
      ydoc.destroy();
    };
  }, [modelId]);

  return (
    <>
      <div className="flex h-screen w-screen flex-col">
        <div className="flex h-[10%] w-full justify-between border-b border-b-border  bg-[#232730] min-[1340px]:h-[5%]">
          <Header onErDocChange={onErDocChange} />
        </div>
        <div className="h-[90%] w-full min-[1340px]:h-[95%]">
          {ydocReady && (
            <Body
              erDoc={erDoc}
              lastChange={lastChange}
              onErDocChange={onErDocChange}
              modelName={modelName}
              ydoc={ydocRef.current!}
              provider={providerRef.current!}
              yNodesMap={ydocRef.current!.getMap("nodesMap")}
              yEdgesMap={ydocRef.current!.getMap("edgesMap")}
            />
          )}
        </div>
      </div>
      {showJoinModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50">
          <div className="w-96 rounded-lg bg-white p-6">
            <h2 className="mb-4 text-xl font-bold">Unirse al diagrama</h2>
            <p className="mb-4">
              No formas parte de este modelo. ¿Quieres unirte?
            </p>
            <div className="flex justify-end gap-2">
              <button
                className="rounded bg-gray-300 px-4 py-2 hover:bg-gray-400"
                onClick={() => router.push(`/${locale}/user`)}
              >
                Cancelar
              </button>
              <button
                className="rounded bg-orange-400 px-4 py-2 text-white hover:bg-orange-600"
                onClick={async () => {
                  const res = await fetch(`/api/diagram/${modelId}/join`, {
                    method: "POST",
                    credentials: "include",
                  });
                  if (res.ok) {
                    const data = await res.json();
                    setModelName(data.model.name);
                    importJSONColaborative(data.model.json, ydocRef.current!);
                    setShowJoinModal(false);
                  }
                }}
              >
                Unirme
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default Page;
