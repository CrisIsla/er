import { Button } from "@chakra-ui/react";
import { useTranslations } from "next-intl";

export const StudyIntro = ({ onStart }: { onStart: () => void }) => {
  const t = useTranslations("study");
  return (
    <>
      <h1 className="mb-6 text-3xl font-bold">{t("intro.title")}</h1>
      <div className="space-y-4 text-lg leading-relaxed">
        <p>{t("intro.p1")}</p>
        <p>{t("intro.p2")}</p>
        <p>{t("intro.p3")}</p>
        <p>{t("intro.p4")}</p>
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
