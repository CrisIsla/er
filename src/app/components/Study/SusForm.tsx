import {
  Button,
  FormControl,
  FormLabel,
  Radio,
  RadioGroup,
  Textarea,
} from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { SUS_ITEMS, susScore } from "../../util/study";

const SCALE = [1, 2, 3, 4, 5];

/**
 * The System Usability Scale, asked about what the task just exercised: the
 * ten statements come from the locale under the test's own key, so each names
 * the marks or the tools rather than "this system".
 */
export const SusForm = ({
  testId,
  index,
  total,
  onDone,
}: {
  testId: string;
  index: number;
  total: number;
  onDone: (answers: number[], score: number, comment: string) => void;
}) => {
  const t = useTranslations("study");
  const [answers, setAnswers] = useState<(number | undefined)[]>(
    Array.from({ length: SUS_ITEMS }, () => undefined),
  );
  const [comment, setComment] = useState("");
  const complete = answers.every((answer) => answer !== undefined);

  const submit = () => {
    const all = answers as number[];
    onDone(all, susScore(all), comment.trim());
  };

  return (
    <>
      <h1 className="mb-2 text-3xl font-bold">
        {t("sus.title", { n: index + 1, total })}
      </h1>
      <p className="mb-8 text-lg text-slate-600">
        {t("sus.intro", { subject: t(`tests.${testId}.subject`) })}
      </p>

      <div className="mb-2 flex justify-end gap-2 text-xs text-slate-500">
        <span>1 = {t("sus.scale_1")}</span>
        <span>·</span>
        <span>5 = {t("sus.scale_5")}</span>
      </div>

      <ol className="divide-y divide-slate-200 rounded-md border border-slate-200 bg-white">
        {answers.map((answer, item) => (
          <li
            key={item}
            className="flex flex-col gap-3 px-5 py-4 md:flex-row md:items-center md:justify-between"
          >
            <span className="md:pr-6">
              <span className="pr-2 text-slate-400">{item + 1}.</span>
              {t(`tests.${testId}.sus.s${item + 1}`)}
            </span>
            <RadioGroup
              value={answer === undefined ? "" : String(answer)}
              onChange={(value) =>
                setAnswers((current) =>
                  current.map((a, i) => (i === item ? Number(value) : a)),
                )
              }
            >
              <div className="flex shrink-0 gap-5">
                {SCALE.map((value) => (
                  <Radio key={value} value={String(value)} colorScheme="blue">
                    {value}
                  </Radio>
                ))}
              </div>
            </RadioGroup>
          </li>
        ))}
      </ol>

      {/* optional, and outside the scale: the score is the ten items alone */}
      <FormControl mt={8}>
        <FormLabel>{t("sus.comment")}</FormLabel>
        <Textarea
          bg="white"
          rows={3}
          placeholder={t("sus.comment_placeholder")}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
        />
      </FormControl>

      <div className="mt-10 flex items-center gap-4">
        <Button
          colorScheme="blue"
          size="lg"
          className="bg-blue-600 text-white hover:bg-blue-700"
          isDisabled={!complete}
          onClick={submit}
        >
          {t("continue")}
        </Button>
        {!complete && (
          <span className="text-sm text-slate-500">{t("required")}</span>
        )}
      </div>
    </>
  );
};
