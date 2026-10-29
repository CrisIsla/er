import {
  Button,
  Checkbox,
  CheckboxGroup,
  FormControl,
  FormLabel,
  Input,
  Radio,
  RadioGroup,
  Select,
  Stack,
} from "@chakra-ui/react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import { Answers } from "../../util/study";

/**
 * The FCFM's undergraduate programmes (Universidad de Chile), as locale keys:
 * the common core everyone starts in, the three science degrees, Geología and
 * the nine Ingeniería Civil specialities. "other" is for anyone else, and asks
 * which.
 */
const PROGRAMMES = [
  "planComun",
  "astronomia",
  "fisica",
  "geofisica",
  "geologia",
  "civil",
  "minas",
  "electrica",
  "biotecnologia",
  "computacion",
  "industrial",
  "matematica",
  "mecanica",
  "quimica",
  "other",
];
const OTHER = "other";

/** Years of study to choose from; "7+" stands for the seventh and beyond. */
const YEARS = ["1", "2", "3", "4", "5", "6", "7+"];

/** The options of the single-choice question, as keys under `background` in the locale. */
const DB_COURSE = ["yes", "inProgress", "no"];

/**
 * The tools one may tick; "other" opens a box to name them, and "none" is
 * for whoever has never drawn one -- it stands alone, so ticking it clears
 * the rest and ticking anything else clears it.
 */
const NONE = "none";
const TOOLS = ["paper", "drawio", "erdoc", OTHER, NONE];

const ER_SCALE = [1, 2, 3, 4, 5, 6, 7];
const FAMILIARITY_SCALE = [1, 2, 3, 4, 5];

const REQUIRED = [
  "programme",
  "year",
  "dbCourse",
  "erExperience",
  "erdocFamiliarity",
];

/** The introductory questions: who the participant is. */
export const BackgroundForm = ({
  onDone,
}: {
  onDone: (answers: Answers) => void;
}) => {
  const t = useTranslations("study");
  const [answers, setAnswers] = useState<Answers>({});
  const answer = (id: string, value: string | number | string[]) =>
    setAnswers((current) => ({ ...current, [id]: value }));

  // what "other" stands for only makes sense with it: picking a listed
  // programme afterwards drops it
  const chooseProgramme = (programme: string) =>
    setAnswers(({ programmeOther, ...current }) => ({
      ...current,
      programme,
      ...(programme === OTHER && programmeOther !== undefined
        ? { programmeOther }
        : {}),
    }));
  const otherProgramme = answers.programme === OTHER;

  const tools = (answers.tools as string[] | undefined) ?? [];
  const otherTool = tools.includes(OTHER);

  const filled = (id: string) =>
    answers[id] !== undefined && String(answers[id]).trim() !== "";
  const complete =
    REQUIRED.every(filled) &&
    (!otherProgramme || filled("programmeOther")) &&
    tools.length > 0 &&
    (!otherTool || filled("toolsOther"));

  const choice = (id: string, options: string[]) => (
    <FormControl key={id} isRequired>
      <FormLabel>{t(`background.${id}`)}</FormLabel>
      <RadioGroup
        value={String(answers[id] ?? "")}
        onChange={(value) => answer(id, value)}
      >
        <Stack direction="row" spacing={6} flexWrap="wrap">
          {options.map((option) => (
            <Radio key={option} value={option} colorScheme="blue">
              {t(`background.${id}_${option}`)}
            </Radio>
          ))}
        </Stack>
      </RadioGroup>
    </FormControl>
  );

  /** A numbered scale between two anchors, from the locale's `_low` and `_high`. */
  const scale = (id: string, values: number[]) => (
    <FormControl key={id} isRequired>
      <FormLabel>{t(`background.${id}`)}</FormLabel>
      <RadioGroup
        value={String(answers[id] ?? "")}
        onChange={(value) => answer(id, Number(value))}
      >
        <Stack direction="row" spacing={5} alignItems="center" flexWrap="wrap">
          <span className="text-sm text-slate-500">
            {t(`background.${id}_low`)}
          </span>
          {values.map((value) => (
            <Radio key={value} value={String(value)} colorScheme="blue">
              {value}
            </Radio>
          ))}
          <span className="text-sm text-slate-500">
            {t(`background.${id}_high`)}
          </span>
        </Stack>
      </RadioGroup>
    </FormControl>
  );

  return (
    <>
      <h1 className="mb-8 text-3xl font-bold">{t("background.title")}</h1>
      <Stack spacing={8}>
        <FormControl isRequired>
          <FormLabel>{t("background.programme")}</FormLabel>
          <Select
            bg="white"
            placeholder={t("background.programme_placeholder")}
            value={String(answers.programme ?? "")}
            onChange={(e) => chooseProgramme(e.target.value)}
          >
            {PROGRAMMES.map((programme) => (
              <option key={programme} value={programme}>
                {t(`background.programme_${programme}`)}
              </option>
            ))}
          </Select>
          {otherProgramme && (
            <Input
              mt={3}
              bg="white"
              placeholder={t("background.programmeOther")}
              value={String(answers.programmeOther ?? "")}
              onChange={(e) => answer("programmeOther", e.target.value)}
            />
          )}
        </FormControl>

        <FormControl isRequired>
          <FormLabel>{t("background.year")}</FormLabel>
          <Select
            bg="white"
            placeholder={t("background.year_placeholder")}
            value={String(answers.year ?? "")}
            onChange={(e) => answer("year", e.target.value)}
          >
            {YEARS.map((year) => (
              <option key={year} value={year}>
                {year === "7+" ? t("background.year_last") : year}
              </option>
            ))}
          </Select>
        </FormControl>

        {choice("dbCourse", DB_COURSE)}
        {scale("erExperience", ER_SCALE)}

        <FormControl isRequired>
          <FormLabel>{t("background.tools")}</FormLabel>
          <CheckboxGroup
            value={tools}
            onChange={(values) => {
              const ticked = values.map(String);
              const chosen =
                ticked.includes(NONE) && !tools.includes(NONE)
                  ? [NONE]
                  : ticked.filter((tool) => tool !== NONE);
              // the box for other tools goes with its tick
              setAnswers((current) => ({
                ...current,
                tools: chosen,
                ...(chosen.includes(OTHER) ? {} : { toolsOther: "" }),
              }));
            }}
          >
            <Stack direction="row" spacing={6} flexWrap="wrap">
              {TOOLS.map((tool) => (
                <Checkbox key={tool} value={tool} colorScheme="blue">
                  {t(`background.tools_${tool}`)}
                </Checkbox>
              ))}
            </Stack>
          </CheckboxGroup>
          {otherTool && (
            <Input
              mt={3}
              bg="white"
              placeholder={t("background.tools_otherPlaceholder")}
              value={String(answers.toolsOther ?? "")}
              onChange={(e) => answer("toolsOther", e.target.value)}
            />
          )}
        </FormControl>

        {scale("erdocFamiliarity", FAMILIARITY_SCALE)}
      </Stack>

      <div className="mt-10 flex items-center gap-4">
        <Button
          colorScheme="blue"
          size="lg"
          className="bg-blue-600 text-white hover:bg-blue-700"
          isDisabled={!complete}
          onClick={() => onDone(answers)}
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
