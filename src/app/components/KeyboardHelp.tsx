import {
  Modal,
  ModalBody,
  ModalCloseButton,
  ModalContent,
  ModalHeader,
  ModalOverlay,
  useDisclosure,
} from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useEffect, useState } from "react";
import { MdKeyboard } from "react-icons/md";
import { isMacPlatform } from "../util/historyShortcut";

/** The rows of the table, as key pairs under `home.keyboard`: `<row>_keys` and `<row>_does`. */
const ROWS = [
  "drag",
  "boxSelect",
  "addToSelection",
  "dragSelection",
  "arrows",
  "shiftArrows",
  "undo",
  "redo",
  "wheel",
  "pan",
  "deselect",
  "resize",
];

/**
 * What the keyboard and the mouse do in the diagram: the gesture, and what it
 * does, one line each. `{mod}` in a gesture is the platform's modifier.
 */
export const ShortcutTable = () => {
  const t = useTranslations("home.keyboard");
  // read on the client only, so the server's render matches the first paint
  const [mod, setMod] = useState("Ctrl");
  useEffect(() => {
    if (isMacPlatform()) setMod("⌘");
  }, []);

  return (
    <table className="w-full text-left">
      <tbody>
        {ROWS.map((row) => (
          <tr key={row} className="border-b border-slate-200 last:border-0">
            <td className="whitespace-nowrap py-2 pr-6 font-medium">
              {t(`${row}_keys`, { mod })}
            </td>
            <td className="py-2 text-slate-600">{t(`${row}_does`)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
};

/** A button that opens the table in a dialog. */
export const KeyboardHelpButton = ({ className }: { className?: string }) => {
  const t = useTranslations("home.keyboard");
  const { isOpen, onOpen, onClose } = useDisclosure();

  return (
    <>
      <button
        type="button"
        className={className}
        onClick={onOpen}
        title={t("title")}
      >
        <MdKeyboard size={20} /> <span className="pl-2">{t("button")}</span>
      </button>

      <Modal isOpen={isOpen} onClose={onClose} isCentered size="xl">
        <ModalOverlay />
        <ModalContent>
          <ModalHeader>{t("title")}</ModalHeader>
          <ModalCloseButton />
          <ModalBody pb={6}>
            <ShortcutTable />
          </ModalBody>
        </ModalContent>
      </Modal>
    </>
  );
};
