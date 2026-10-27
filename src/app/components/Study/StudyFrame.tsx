import { ReactNode } from "react";
import { useTranslations } from "next-intl";

/**
 * The frame every phase of the study sits in: the app's dark bar with the
 * study's name and where the participant is, and the phase's content below.
 * A task fills the whole height with its diagram; the questionnaires sit in
 * a column that scrolls.
 */
export const StudyFrame = ({
  step,
  total,
  fill = false,
  children,
}: {
  step: number;
  total: number;
  fill?: boolean;
  children: ReactNode;
}) => {
  const t = useTranslations("study");
  return (
    <div className="flex h-screen w-screen flex-col bg-slate-50">
      <div className="flex h-12 shrink-0 items-center justify-between border-b border-b-border bg-[#232730] px-6 text-slate-200">
        <span>
          <span className="font-sans font-bold">ERdoc Playground</span>
          <span className="pl-3 text-slate-400">{t("title")}</span>
        </span>
        <span className="text-sm text-slate-400">
          {t("step", { n: step, total })}
        </span>
      </div>
      {fill ? (
        <div className="min-h-0 flex-1">{children}</div>
      ) : (
        <div className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-3xl px-6 py-10 text-slate-800">
            {children}
          </div>
        </div>
      )}
    </div>
  );
};
