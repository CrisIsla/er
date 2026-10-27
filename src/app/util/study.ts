/**
 * The user study: what it consists of, and what it records.
 *
 * The page at [locale]/study walks a participant through the phases below.
 * Everything it records goes into one `StudySession`, kept in localStorage
 * after every step (so a reload resumes where it was) and sent whole to
 * /api/study, which upserts it by participant id.
 */

import {
  DEFAULT_DIAGRAM_SETTINGS,
  DiagramSettings,
} from "../hooks/useDiagramSettings";
import { ErJSON } from "../hooks/useJSON";

export type StudyTest = {
  /** key under `study.tests` in the locale files */
  id: string;
  /** the problem diagram, under static/examples */
  example: string;
  /**
   * The settings the task runs under -- the whole object, not a patch, so a
   * preference stored on the machine cannot leak into a condition.
   */
  settings: DiagramSettings;
  /**
   * Whether the keyboard shortcuts work in the task -- box selection,
   * Ctrl+click, the arrow keys, undo -- and whether their table is shown.
   * Only the task that measures them has them.
   */
  shortcuts: boolean;
};

/** The settings of the two arranging tasks: guides and snap, and shapes that stop at each other. */
const ARRANGING: DiagramSettings = {
  ...DEFAULT_DIAGRAM_SETTINGS,
  spacingGuidesEnabled: true,
  snapEnabled: true,
  collisionEnabled: true,
};

export const STUDY_TESTS: StudyTest[] = [
  {
    id: "overlaps",
    example: "problem-01",
    settings: { ...DEFAULT_DIAGRAM_SETTINGS, highlightOcclusions: true },
    shortcuts: false,
  },
  {
    id: "spacing",
    example: "problem-02",
    settings: ARRANGING,
    shortcuts: false,
  },
  { id: "groups", example: "problem-03", settings: ARRANGING, shortcuts: true },
];

export type StudyPhase =
  | { kind: "intro" }
  | { kind: "background" }
  | { kind: "help" }
  | { kind: "task"; test: number }
  | { kind: "sus"; test: number }
  | { kind: "end" };

/**
 * Intro, background questions, then each task followed by its SUS -- with the
 * shortcuts shown right before the first task that has them.
 */
export const STUDY_PHASES: StudyPhase[] = [
  { kind: "intro" },
  { kind: "background" },
  ...STUDY_TESTS.flatMap(({ shortcuts }, test): StudyPhase[] => [
    ...(shortcuts && !STUDY_TESTS.slice(0, test).some((t) => t.shortcuts)
      ? [{ kind: "help" } as StudyPhase]
      : []),
    { kind: "task", test },
    { kind: "sus", test },
  ]),
  { kind: "end" },
];

/** A questionnaire's answers by question id; a multiple choice is a list. */
export type Answers = Record<string, string | number | string[]>;

export type TestResult = {
  id: string;
  example: string;
  settings: DiagramSettings;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
  /** the diagram as the participant left it, loadable with Save/load File */
  layout?: ErJSON;
  sus?: {
    answers: number[];
    score: number;
    /** free text left after the ten items, not part of the score */
    comment?: string;
    submittedAt: string;
  };
};

export type StudySession = {
  version: 1;
  participantId: string;
  locale: string;
  startedAt: string;
  finishedAt?: string;
  /** index into STUDY_PHASES */
  phase: number;
  environment: {
    userAgent: string;
    screen: { width: number; height: number; pixelRatio: number };
  };
  background?: { answers: Answers; submittedAt: string };
  tests: TestResult[];
};

export const SUS_ITEMS = 10;

/**
 * The System Usability Scale score, 0-100 (Brooke, 1996): odd items count
 * their answer minus one, even items five minus their answer, and the sum is
 * scaled by 2.5. Answers are 1-5.
 */
export const susScore = (answers: number[]): number => {
  if (answers.length !== SUS_ITEMS) throw new Error("SUS has ten items");
  const total = answers.reduce(
    (sum, answer, index) => sum + (index % 2 === 0 ? answer - 1 : 5 - answer),
    0,
  );
  return total * 2.5;
};

const STORAGE_KEY = "er-study-session";

export const newParticipantId = () =>
  `P-${Date.now().toString(36)}-${Math.random()
    .toString(36)
    .slice(2, 6)}`.toUpperCase();

export const newSession = (locale: string): StudySession => ({
  version: 1,
  participantId: newParticipantId(),
  locale,
  startedAt: new Date().toISOString(),
  phase: 0,
  environment: {
    userAgent: navigator.userAgent,
    screen: {
      width: window.screen.width,
      height: window.screen.height,
      pixelRatio: window.devicePixelRatio,
    },
  },
  tests: STUDY_TESTS.map(({ id, example, settings }) => ({
    id,
    example,
    settings,
  })),
});

export const loadSession = (): StudySession | null => {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored === null) return null;
    const session = JSON.parse(stored) as StudySession;
    return session.version === 1 && Array.isArray(session.tests)
      ? session
      : null;
  } catch {
    return null;
  }
};

export const saveSession = (session: StudySession) =>
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));

export const clearSession = () => localStorage.removeItem(STORAGE_KEY);

/** Sends the session to the server. False when it could not be stored there. */
export const uploadSession = async (
  session: StudySession,
): Promise<boolean> => {
  try {
    const res = await fetch("/api/study", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(session),
    });
    return res.ok;
  } catch {
    return false;
  }
};

/** Hands the session to the browser as a JSON file. */
export const downloadSession = (session: StudySession) => {
  const a = document.createElement("a");
  a.download = `erdoc-study-${session.participantId}.json`;
  a.href =
    "data:application/json;charset=utf-8," +
    encodeURIComponent(JSON.stringify(session, null, 2));
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
};
