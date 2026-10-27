import { Button } from "@chakra-ui/react";
import { useTranslations } from "next-intl";

/** What the second part is, shown once before the first task. */
export const StudyTasksIntro = ({ onStart }: { onStart: () => void }) => {
  const t = useTranslations("study");
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold">{t("tasksIntro.title")}</h1>
      <div className="space-y-4 text-lg leading-relaxed">
        <p>{t("tasksIntro.p1")}</p>
        <p>{t("tasksIntro.p2")}</p>
        <p>{t("tasksIntro.p3")}</p>
      </div>
      <Button
        colorScheme="blue"
        size="lg"
        className="mt-10 bg-blue-600 text-white hover:bg-blue-700"
        onClick={onStart}
      >
        {t("start")}
      </Button>
    </>
  );
};
