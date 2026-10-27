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

/**
 * Two versions of one diagram, shown side by side for the participant to pick
 * the one they like more. They differ in one setting only: the layout
 * algorithm, or where the lines meet the shapes (fig2's pair). Named by the
 * screenshots' original file stems; the files under public/study/pairs carry
 * meaningless names, so a participant who opens one cannot read the version
 * from the address.
 */
export type StudyPair = {
  /** key of the answer, and of its hint under `study.pairs.hint_<id>` */
  id: string;
  /** the two versions; which one goes on the left is drawn per participant */
  versions: [string, string];
  /** the screenshots' width and height, which the cards keep the shape of */
  size: [number, number];
  hint?: boolean;
};

/** The screenshot of each version: `/study/pairs/<file>.svg`, with a `.png` twin. */
export const PAIR_IMAGES: Record<string, string> = {
  "fig1_no-attributes_center-connection_old-algorithm": "097bc4",
  "fig1_no-attributes_center-connection_new-algorithm": "f852ac",
  "fig2_with-attributes_edge-connection_old-algorithm": "36b290",
  "fig2_with-attributes_center-connection_old-algorithm": "cf7c4e",
  "fig3_no-attributes_center-connection_old-algorithm": "a30825",
  "fig3_no-attributes_center-connection_new-algorithm": "d63508",
  "fig4_no-attributes_center-connection_old-algorithm": "37fd42",
  "fig4_no-attributes_center-connection_new-algorithm": "0ee4c2",
  "fig5_no-attributes_center-connection_old-algorithm": "a28e38",
  "fig5_no-attributes_center-connection_new-algorithm": "f9a663",
  "fig6_no-attributes_center-connection_old-algorithm": "f720bb",
  "fig6_no-attributes_center-connection_new-algorithm": "b2e17b",
  "fig7_no-attributes_center-connection_old-algorithm": "5c7658",
  "fig7_no-attributes_center-connection_new-algorithm": "c864b6",
  "fig8_no-attributes_center-connection_old-algorithm": "bf07ad",
  "fig8_no-attributes_center-connection_new-algorithm": "6eb443",
  "fig9_no-attributes_center-connection_old-algorithm": "04ac55",
  "fig9_no-attributes_center-connection_new-algorithm": "d9400e",
  "fig10_no-attributes_center-connection_old-algorithm": "2a66f5",
  "fig10_no-attributes_center-connection_new-algorithm": "a22424",
};

const layoutPair = (
  id: string,
  fig: string,
  size: [number, number],
): StudyPair => ({
  id,
  versions: [
    `${fig}_no-attributes_center-connection_old-algorithm`,
    `${fig}_no-attributes_center-connection_new-algorithm`,
  ],
  size,
});

/**
 * The pairs, in a fixed order from the simplest diagram to the most complex,
 * each diagram once: nine layout pairs, old against new with the lines to the
 * centre and no attributes, and one connection pair, edge against centre, on
 * the old layout with attributes.
 */
export const STUDY_PAIRS: StudyPair[] = [
  layoutPair("layout-fig1", "fig1", [869, 700]),
  {
    id: "conexion-fig2",
    versions: [
      "fig2_with-attributes_edge-connection_old-algorithm",
      "fig2_with-attributes_center-connection_old-algorithm",
    ],
    size: [886, 460],
    hint: true,
  },
  layoutPair("layout-fig3", "fig3", [894, 886]),
  layoutPair("layout-supervision", "fig10", [1380, 764]),
  layoutPair("layout-fig4", "fig4", [764, 886]),
  layoutPair("layout-metro", "fig8", [1136, 886]),
  layoutPair("layout-fig5", "fig5", [872, 886]),
  layoutPair("layout-torneo", "fig7", [940, 886]),
  layoutPair("layout-editorial", "fig9", [1155, 886]),
  layoutPair("layout-universidad", "fig6", [1380, 682]),
];

export type StudyPhase =
  | { kind: "intro" }
  | { kind: "pairs" }
  | { kind: "background" }
  | { kind: "tasksIntro" }
  | { kind: "help" }
  | { kind: "task"; test: number }
  | { kind: "sus"; test: number }
  | { kind: "end" };

/**
 * Intro, the background questions, the pairs, then -- after a page that says
 * what comes -- each task followed by its SUS, with the shortcuts shown right
 * before the first task that has them. The pairs come before the tasks so the
 * preference is given before the tool has been used.
 */
export const STUDY_PHASES: StudyPhase[] = [
  { kind: "intro" },
  { kind: "background" },
  { kind: "pairs" },
  { kind: "tasksIntro" },
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

export type PairAnswer = {
  id: string;
  /** the versions as they were shown */
  left: string;
  right: string;
  chosen: string;
  /** from the pair appearing to the answer being confirmed */
  ms: number;
  /** which screenshots were shown: the SVGs, or their PNG twins on WebKit */
  format: "svg" | "png";
};

export type PairsResult = {
  startedAt: string;
  finishedAt: string;
  answers: PairAnswer[];
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
  pairs?: PairsResult;
  background?: { answers: Answers; submittedAt: string };
  tests: TestResult[];
};

/** FNV-1a over the text, as the seed of a draw that has to repeat for the same participant. */
const hashOf = (text: string): number => {
  let hash = 0x811c9dc5;
  for (const char of text) {
    hash ^= char.codePointAt(0)!;
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** mulberry32: a small seeded generator, good enough for which side a version goes. */
const seededRandom = (seed: number) => () => {
  seed = (seed + 0x6d2b79f5) >>> 0;
  let t = seed;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

/**
 * Which pairs show their second version on the left: drawn once per
 * participant, from their id, so a reload shows every pair the same way round.
 */
export const pairSides = (participantId: string): boolean[] => {
  const random = seededRandom(hashOf(`pairs:${participantId}`));
  return STUDY_PAIRS.map(() => random() < 0.5);
};

/**
 * Whether the screenshots have to be the PNGs. WebKit -- Safari, and every
 * browser on an iPhone or iPad -- draws these SVGs at their own size whatever
 * size the page gives them (WebKit bug 23113); Chrome and Firefox get the SVGs.
 */
export const usesPngImages = (): boolean => {
  if (typeof navigator === "undefined") return false;
  const ua = navigator.userAgent;
  return (
    navigator.vendor === "Apple Computer, Inc." ||
    (/AppleWebKit\//.test(ua) && !/(Chrome|Chromium)\//.test(ua))
  );
};

export const pairImageUrl = (version: string, png: boolean): string =>
  `/study/pairs/${PAIR_IMAGES[version]}.${png ? "png" : "svg"}`;

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
