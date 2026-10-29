"use client";
import { useLocale } from "next-intl";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { BackgroundForm } from "../../components/Study/BackgroundForm";
import { StudyEnd } from "../../components/Study/StudyEnd";
import { StudyFrame } from "../../components/Study/StudyFrame";
import { StudyHelp } from "../../components/Study/StudyHelp";
import { StudyIntro } from "../../components/Study/StudyIntro";
import { StudyPairs } from "../../components/Study/StudyPairs";
import { StudyTask, TaskOutcome } from "../../components/Study/StudyTask";
import { StudyTasksIntro } from "../../components/Study/StudyTasksIntro";
import { SusForm } from "../../components/Study/SusForm";
import {
  STUDY_PHASES,
  STUDY_TESTS,
  StudySession,
  loadSession,
  newSession,
  saveSession,
  uploadSession,
} from "../../util/study";

/** The study runs in Spanish: its texts exist in that locale only. */
const STUDY_LOCALE = "es";

/**
 * The user study, phase by phase: an explanation, the introductory
 * questions, then each task followed by its SUS, and a closing page.
 *
 * The session is written to localStorage and sent to the server after every
 * phase, so a reload lands on the phase that was on screen rather than at the
 * start, and nothing already answered is lost.
 */
const StudyPage = () => {
  const locale = useLocale();
  const router = useRouter();
  const inStudyLocale = locale === STUDY_LOCALE;
  const [session, setSession] = useState<StudySession | null>(null);
  const [savedOnServer, setSavedOnServer] = useState<boolean | null>(null);

  useEffect(() => {
    if (!inStudyLocale) router.replace(`/${STUDY_LOCALE}/study`);
  }, [inStudyLocale, router]);

  // localStorage is only there on the client
  useEffect(() => {
    if (inStudyLocale) setSession(loadSession() ?? newSession(locale));
  }, [locale, inStudyLocale]);

  /** Records what the phase produced and moves to the next one. */
  const advance = (change: (session: StudySession) => StudySession) => {
    if (session === null) return;
    const next = change({
      ...session,
      tests: session.tests.map((t) => ({ ...t })),
    });
    next.phase = Math.min(next.phase + 1, STUDY_PHASES.length - 1);
    if (STUDY_PHASES[next.phase].kind === "end")
      next.finishedAt = new Date().toISOString();
    setSession(next);
    saveSession(next);
    setSavedOnServer(null);
    void uploadSession(next).then(setSavedOnServer);
  };

  if (!inStudyLocale || session === null) return null;

  const phase = STUDY_PHASES[session.phase];
  const step = session.phase + 1;
  const total = STUDY_PHASES.length;

  switch (phase.kind) {
    case "intro":
      return (
        <StudyFrame step={step} total={total}>
          <StudyIntro onStart={() => advance((s) => s)} />
        </StudyFrame>
      );

    case "pairs":
      return (
        <StudyFrame step={step} total={total} fill>
          <StudyPairs
            participantId={session.participantId}
            onDone={(pairs) => advance((s) => ({ ...s, pairs }))}
          />
        </StudyFrame>
      );

    case "background":
      return (
        <StudyFrame step={step} total={total}>
          <BackgroundForm
            onDone={(answers) =>
              advance((s) => ({
                ...s,
                background: { answers, submittedAt: new Date().toISOString() },
              }))
            }
          />
        </StudyFrame>
      );

    case "tasksIntro":
      return (
        <StudyFrame step={step} total={total}>
          <StudyTasksIntro onStart={() => advance((s) => s)} />
        </StudyFrame>
      );

    case "help":
      return (
        <StudyFrame step={step} total={total}>
          <StudyHelp onDone={() => advance((s) => s)} />
        </StudyFrame>
      );

    case "task":
      return (
        <StudyFrame step={step} total={total} fill>
          <StudyTask
            key={phase.test}
            test={STUDY_TESTS[phase.test]}
            index={phase.test}
            total={STUDY_TESTS.length}
            onDone={({ startedAt, finishedAt, layout }: TaskOutcome) =>
              advance((s) => {
                s.tests[phase.test] = {
                  ...s.tests[phase.test],
                  startedAt,
                  finishedAt,
                  durationMs: Date.parse(finishedAt) - Date.parse(startedAt),
                  layout,
                };
                return s;
              })
            }
          />
        </StudyFrame>
      );

    case "sus":
      return (
        <StudyFrame step={step} total={total}>
          <SusForm
            key={phase.test}
            testId={STUDY_TESTS[phase.test].id}
            index={phase.test}
            total={STUDY_TESTS.length}
            onDone={(answers, score, comment) =>
              advance((s) => {
                s.tests[phase.test] = {
                  ...s.tests[phase.test],
                  sus: {
                    answers,
                    score,
                    ...(comment ? { comment } : {}),
                    submittedAt: new Date().toISOString(),
                  },
                };
                return s;
              })
            }
          />
        </StudyFrame>
      );

    case "end":
      return (
        <StudyFrame step={step} total={total}>
          <StudyEnd session={session} savedOnServer={savedOnServer} />
        </StudyFrame>
      );
  }
};

export default StudyPage;
