"use client";
import {
  Button,
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalFooter,
  ModalHeader,
  ModalOverlay,
  useDisclosure,
} from "@chakra-ui/react";
import { useMonaco } from "@monaco-editor/react";
import { useTranslations } from "next-intl";
import { LuFilePlus } from "react-icons/lu";
import { ErDocChangeEvent } from "../../types/CodeEditor";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";

type NewDiagramButtonProps = {
  onErDocChange: (evt: ErDocChangeEvent) => void;
};

const NewDiagramButton = ({ onErDocChange }: NewDiagramButtonProps) => {
  const { isOpen, onOpen, onClose } = useDisclosure();
  const [showCustomModal, setShowCustomModal] = useState(false);
  const [newDiagramName, setNewDiagramName] = useState("");
  const monaco = useMonaco();
  const router = useRouter();
  const locale = useLocale();
  const t = useTranslations("home.header.newDiagram");

  const checkLogin = async () => {
    try {
      const res = await fetch("/api/user", { credentials: "include" });
      if (res.ok) {
        const data = await res.json();
        return data != null;
      }
    } catch (err) {
      console.error("Error al verificar login:", err);
    }
    return false;
  };

  const handleClick = async () => {
    const loggedIn = await checkLogin();
    if (loggedIn) {
      setShowCustomModal(true);
    } else {
      onOpen();
    }
  };

  const onModalButtonClick = () => {
    const codeEditorModel = monaco?.editor.getModels()[0];
    codeEditorModel?.setValue("");
    onErDocChange({
      er: {
        aggregations: [],
        entities: [],
        relationships: [],
      },
      type: "userInput",
    });
    onClose();
  };

  const handleCreateDiagram = async () => {
    if (!newDiagramName.trim()) return;
    const res = await fetch("/api/diagram/create", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ name: newDiagramName }),
      credentials: "include",
    });

    if (res.ok) {
      const data = await res.json();
      setShowCustomModal(false);
      router.push(`/${locale}/${data.id}`);
    } else {
      console.error("Error creating diagram");
    }
  };

  return (
    <>
      <button className="flex items-center" onClick={handleClick}>
        <LuFilePlus size={25} /> <span className="pl-2">{t("title")}</span>
      </button>

      <Modal isOpen={isOpen} onClose={onClose}>
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{t("modalTitle")}</ModalHeader>
          <ModalCloseButton />
          <ModalBody>{t("modalDescription")}</ModalBody>
          <ModalFooter>
            <Button
              variant="outline"
              colorScheme="gray"
              onClick={onModalButtonClick}
            >
              {t("modalConfirm")}
            </Button>
          </ModalFooter>
        </ModalContent>
      </Modal>

      {showCustomModal && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 flex items-center justify-center bg-black bg-opacity-50"
        >
          <div className="w-80 rounded-lg bg-white p-6">
            <h2 className="mb-4 text-xl font-bold text-black">
              Nombre del diagrama
            </h2>
            <input
              type="text"
              placeholder="Nombre del diagrama"
              value={newDiagramName}
              onChange={(e) => setNewDiagramName(e.target.value)}
              className="mb-4 w-full rounded border p-2 text-black"
            />
            <div className="flex justify-end gap-2">
              <button
                onClick={() => setShowCustomModal(false)}
                className="rounded bg-gray-300 px-4 py-2 font-bold text-black hover:bg-gray-400"
              >
                Cancelar
              </button>
              <button
                onClick={handleCreateDiagram}
                className="rounded bg-orange-400 px-4 py-2 font-bold text-white hover:bg-orange-600"
              >
                Aceptar
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
};

export default NewDiagramButton;
