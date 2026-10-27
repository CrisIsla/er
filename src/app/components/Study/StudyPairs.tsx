import { Button } from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PairAnswer,
  PairsResult,
  STUDY_PAIRS,
  pairImageUrl,
  pairSides,
  usesPngImages,
} from "../../util/study";

/**
 * The pairs: two versions of one diagram side by side, pick the one you like
 * more. First the explanation, then the pairs in their fixed order, each
 * with the sides drawn for this participant. A click on a card picks it, a
 * click on the other switches, a click on the pick takes it back; the arrow
 * keys do the same. The answer is confirmed with the button, or with a double
 * click on the card, and the time to it is kept with the choice.
 */
export const StudyPairs = ({
  participantId,
  onDone,
}: {
  participantId: string;
  onDone: (result: PairsResult) => void;
}) => {
  const t = useTranslations("study");
  const [started, setStarted] = useState(false);
  const [index, setIndex] = useState(0);
  const [picked, setPicked] = useState<string | null>(null);
  const [answers, setAnswers] = useState<PairAnswer[]>([]);
  // the screenshots' format is read off the browser when the pairs start,
  // on the client; the pairs only show after that click
  const [png, setPng] = useState(false);
  const sides = useMemo(() => pairSides(participantId), [participantId]);
  const startedAt = useRef<string>("");
  const shownAt = useRef(0);

  const pair = STUDY_PAIRS[index];
  const swapped = sides[index];
  const [left, right] = swapped
    ? [pair.versions[1], pair.versions[0]]
    : pair.versions;

  // the clock starts when the pair is on screen
  useEffect(() => {
    if (started) shownAt.current = performance.now();
    setPicked(null);
  }, [started, index]);

  useEffect(() => {
    if (!started) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") setPicked(left);
      else if (event.key === "ArrowRight") setPicked(right);
    };
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [started, left, right]);

  const confirmWith = (chosen: string) => {
    const answer: PairAnswer = {
      id: pair.id,
      left,
      right,
      chosen,
      ms: Math.round(performance.now() - shownAt.current),
      format: png ? "png" : "svg",
    };
    const all = [...answers, answer];
    // the button keeps the focus otherwise, and Enter would confirm the next
    // pair unseen
    (document.activeElement as HTMLElement | null)?.blur();
    if (index + 1 < STUDY_PAIRS.length) {
      setAnswers(all);
      setIndex(index + 1);
    } else {
      onDone({
        startedAt: startedAt.current,
        finishedAt: new Date().toISOString(),
        answers: all,
      });
    }
  };

  if (!started)
    return (
      <div className="mx-auto w-full max-w-3xl px-6 py-10 text-slate-800">
        <h1 className="mb-6 text-3xl font-bold">{t("pairs.title")}</h1>
        <div className="space-y-4 text-lg leading-relaxed">
          <p>{t("pairs.intro1")}</p>
          <p>{t("pairs.intro2")}</p>
        </div>
        <Button
          colorScheme="blue"
          size="lg"
          className="mt-10 bg-blue-600 text-white hover:bg-blue-700"
          onClick={() => {
            setPng(usesPngImages());
            startedAt.current = new Date().toISOString();
            setStarted(true);
          }}
        >
          {t("start")}
        </Button>
      </div>
    );

  const [width, height] = pair.size;

  return (
    <div className="flex h-full w-full flex-col px-8 py-4 text-slate-800">
      <div className="mb-3 shrink-0">
        <div className="text-sm font-semibold uppercase tracking-wide text-slate-500">
          {t("pairs.counter", { n: index + 1, total: STUDY_PAIRS.length })}
        </div>
        <div className="text-xl font-semibold">{t("pairs.prompt")}</div>
        {pair.hint && (
          <div className="mt-1 text-slate-600">
            {t(`pairs.hint_${pair.id}`)}
          </div>
        )}
      </div>

      {/* each card hugs its screenshot: as wide as the column allows, or as
          wide as the height left on screen allows, whichever is less */}
      <div className="grid min-h-0 flex-1 grid-cols-2 items-start justify-items-center gap-6">
        {[left, right].map((version) => {
          const isPicked = picked === version;
          return (
            <button
              key={version}
              type="button"
              aria-pressed={isPicked}
              onClick={() => setPicked(isPicked ? null : version)}
              onDoubleClick={() => confirmWith(version)}
              className={`flex w-full flex-col items-center rounded-lg border-4 bg-white p-2 ${
                isPicked
                  ? "border-blue-600"
                  : "border-slate-200 hover:border-slate-400"
              }`}
              style={{
                maxWidth: `calc((100vh - 250px) * ${width} / ${height})`,
              }}
            >
              <img
                src={pairImageUrl(version, png)}
                alt=""
                draggable={false}
                className="h-auto w-full"
                style={{ aspectRatio: `${width} / ${height}` }}
              />
              <div className="h-7 shrink-0 pt-1 font-semibold text-blue-700">
                {isPicked ? `✓ ${t("pairs.this")}` : ""}
              </div>
            </button>
          );
        })}
      </div>

      <div className="mt-3 flex shrink-0 items-center gap-4">
        <Button
          colorScheme="blue"
          size="lg"
          className="bg-blue-600 text-white hover:bg-blue-700"
          isDisabled={picked === null}
          onClick={() => picked !== null && confirmWith(picked)}
        >
          {t("continue")}
        </Button>
        <span className="text-sm text-slate-500">{t("pairs.keys")}</span>
      </div>
    </div>
  );
};
