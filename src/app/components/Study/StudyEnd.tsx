import { Button } from "@chakra-ui/react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { MdDownload } from "react-icons/md";
import { STUDY_ONLY, StudySession, downloadSession } from "../../util/study";

/**
 * The last page: thanks, and that the results are saved. Participants take
 * the study on their own computers, so there is nothing for them to do here
 * -- the download only appears when the last save did not reach the server,
 * as the one way left to get the results out.
 */
export const StudyEnd = ({
  session,
  savedOnServer,
}: {
  session: StudySession;
  /** null while the last save is still on its way */
  savedOnServer: boolean | null;
}) => {
  const t = useTranslations("study");
  const locale = useLocale();
  const router = useRouter();

  return (
    <>
      <h1 className="mb-6 text-3xl font-bold">{t("end.title")}</h1>
      <p className="text-lg">{t("end.body")}</p>
      <p
        className={`mt-4 text-lg ${
          savedOnServer === false ? "text-amber-700" : "text-slate-600"
        }`}
      >
        {savedOnServer === false ? t("end.savedLocal") : t("end.savedServer")}
      </p>

      {(savedOnServer === false || !STUDY_ONLY) && (
        <div className="mt-8 flex flex-wrap items-center gap-4">
          {savedOnServer === false && (
            <Button
              leftIcon={<MdDownload />}
              colorScheme="blue"
              className="bg-blue-600 text-white hover:bg-blue-700"
              onClick={() => downloadSession(session)}
            >
              {t("end.download")}
            </Button>
          )}
          {!STUDY_ONLY && (
            <Button variant="ghost" onClick={() => router.push(`/${locale}`)}>
              {t("end.backToApp")}
            </Button>
          )}
        </div>
      )}
    </>
  );
};
