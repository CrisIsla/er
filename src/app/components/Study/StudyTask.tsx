import {
  Button,
  Modal,
  ModalBody,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  Spinner,
  useDisclosure,
} from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useEffect, useRef, useState } from "react";
import { useReactFlow } from "reactflow";
import { getERDoc } from "../../../ERDoc";
import { ER } from "../../../ERDoc/types/parser/ER";
import { DiagramHistoryProvider } from "../../hooks/useDiagramHistory";
import { useDiagramSettings } from "../../hooks/useDiagramSettings";
import { ErJSON, toErJSONEdges, toErJSONNodes } from "../../hooks/useJSON";
import { DiagramChange } from "../../types/CodeEditor";
import { fetchExample } from "../../util/common";
import { StudyTest } from "../../util/study";
import { ErDiagram } from "../ErDiagram/ErDiagram";
import { KeyboardHelpIcon } from "../KeyboardHelp";

export type TaskOutcome = {
  startedAt: string;
  finishedAt: string;
  layout: ErJSON;
};

/**
 * One task of the study: the problem diagram, the instruction, and the
 * button that ends it.
 *
 * The diagram is the playground's own component in study mode -- no code
 * editor, no settings panel, no layout button -- shown under the task's
 * settings. When the participant says they are done, the layout is read back
 * out of React Flow in the same form the problem files use, so a result can be
 * opened in the playground with Save/load File.
 */
export const StudyTask = ({
  test,
  index,
  total,
  onDone,
}: {
  test: StudyTest;
  index: number;
  total: number;
  onDone: (outcome: TaskOutcome) => void;
}) => {
  const t = useTranslations("study");
  const { setOverride } = useDiagramSettings();
  const { getNodes, getEdges } = useReactFlow();
  const confirm = useDisclosure();

  const [erDocText, setErDocText] = useState<string | null>(null);
  const [erDoc, setErDoc] = useState<ER | null>(null);
  const [lastChange, setLastChange] = useState<DiagramChange | null>(null);
  const [failed, setFailed] = useState(false);
  const startedAt = useRef<string | null>(null);

  // the task's settings, for as long as the task is on screen
  useEffect(() => {
    setOverride(test.settings);
    return () => setOverride(null);
  }, [test, setOverride]);

  useEffect(() => {
    let cancelled = false;
    fetchExample(test.example)
      .then((example) => {
        if (cancelled) return;
        if (!example) throw new Error(`no example ${test.example}`);
        const [er, errors] = getERDoc(example.erDoc);
        if (errors.length > 0) throw new Error("the example has errors");
        setErDocText(example.erDoc);
        setErDoc(er);
        setLastChange({
          type: "json",
          positions: { nodes: example.nodes, edges: example.edges },
        });
        startedAt.current = new Date().toISOString();
      })
      .catch((err) => {
        console.error("Error loading the task", err);
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [test]);

  const finish = () => {
    confirm.onClose();
    onDone({
      startedAt: startedAt.current ?? new Date().toISOString(),
      finishedAt: new Date().toISOString(),
      layout: {
        erDoc: erDocText ?? "",
        nodes: toErJSONNodes(getNodes()),
        edges: toErJSONEdges(getEdges()),
      },
    });
  };

  const ready = erDoc !== null && lastChange !== null;

  return (
    <div className="flex h-full w-full flex-col">
      <div className="flex shrink-0 items-start justify-between gap-6 border-b border-slate-200 bg-white px-6 py-3 text-slate-800">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">
            {t("task.heading", { n: index + 1, total })} ·{" "}
            {t(`tests.${test.id}.title`)}
          </div>
          <p className="mt-1 max-w-4xl text-lg leading-snug">
            {t(`tests.${test.id}.instruction`)}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-6">
          {test.shortcuts && (
            <KeyboardHelpIcon className="flex items-center text-slate-500 hover:text-slate-800" />
          )}
          <Button
            colorScheme="blue"
            size="lg"
            className="shrink-0 bg-blue-600 text-white hover:bg-blue-700"
            isDisabled={!ready}
            onClick={confirm.onOpen}
          >
            {t("done")}
          </Button>
        </div>
      </div>

      <div className="min-h-0 flex-1">
        {failed ? (
          <div className="flex h-full items-center justify-center text-red-700">
            {t("loadFailed")}
          </div>
        ) : ready ? (
          <DiagramHistoryProvider
            lastChange={lastChange}
            keyboard={test.shortcuts}
          >
            <ErDiagram
              erDoc={erDoc}
              erDocHasError={false}
              lastChange={lastChange}
              study
              shortcuts={test.shortcuts}
            />
          </DiagramHistoryProvider>
        ) : (
          <div className="flex h-full items-center justify-center gap-3 text-slate-500">
            <Spinner /> {t("loading")}
          </div>
        )}
      </div>

      <Modal isOpen={confirm.isOpen} onClose={confirm.onClose} isCentered>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{t("task.confirmTitle")}</ModalHeader>
          <ModalBody>{t("task.confirmBody")}</ModalBody>
          <ModalFooter gap={3}>
            <Button variant="ghost" onClick={confirm.onClose}>
              {t("back")}
            </Button>
            <Button
              colorScheme="blue"
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={finish}
            >
              {t("task.confirm")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>
    </div>
  );
};
