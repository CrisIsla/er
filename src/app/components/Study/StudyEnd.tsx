import { Button } from "@chakra-ui/react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { MdDownload } from "react-icons/md";
import { StudySession, downloadSession } from "../../util/study";

/**
 * The last page: thanks, whether the results reached the server, the
 * download that works either way, and -- for whoever runs the session -- a
 * way to start the next participant's.
 */
export const StudyEnd = ({
  session,
  savedOnServer,
  onNewSession,
}: {
  session: StudySession;
  /** null while the last save is still on its way */
  savedOnServer: boolean | null;
  onNewSession: () => void;
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

      <div className="mt-8 flex flex-wrap items-center gap-4">
        <Button
          leftIcon={<MdDownload />}
          colorScheme="blue"
          variant={savedOnServer === false ? "solid" : "outline"}
          className={
            savedOnServer === false
              ? "bg-blue-600 text-white hover:bg-blue-700"
              : undefined
          }
          onClick={() => downloadSession(session)}
        >
          {t("end.download")}
        </Button>
        <Button variant="ghost" onClick={() => router.push(`/${locale}`)}>
          {t("end.backToApp")}
        </Button>
      </div>

      <div className="mt-16 border-t border-slate-200 pt-6 text-sm text-slate-500">
        <p className="mb-3">
          {t("end.newSessionHint")} · {session.participantId}
        </p>
        <Button size="sm" variant="outline" onClick={onNewSession}>
          {t("end.newSession")}
        </Button>
      </div>
    </>
  );
};
