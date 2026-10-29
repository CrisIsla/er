import { Button } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { ShortcutTable } from "../KeyboardHelp";

/** The shortcuts, shown once before the first task; each task can reopen them. */
export const StudyHelp = ({ onDone }: { onDone: () => void }) => {
  const t = useTranslations("study");
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold">{t("help.title")}</h1>
      <p className="mb-4 text-lg leading-relaxed">{t("help.p1")}</p>
      <div className="rounded-md border border-slate-200 bg-white px-5 py-2">
        <ShortcutTable />
      </div>
      <p className="mt-4 text-sm text-slate-500">{t("help.again")}</p>
      <Button
        colorScheme="blue"
        size="lg"
        className="mt-8 bg-blue-600 text-white hover:bg-blue-700"
        onClick={onDone}
      >
        {t("continue")}
      </Button>
    </>
  );
};
