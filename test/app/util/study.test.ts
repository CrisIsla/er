import {
  STUDY_PHASES,
  STUDY_TESTS,
  SUS_ITEMS,
  susScore,
} from "../../../src/app/util/study";

describe("susScore", () => {
  it("scores all-agree at the top and all-disagree at the bottom of the scale", () => {
    // odd items count up from 1, even items count down from 5
    expect(susScore([5, 1, 5, 1, 5, 1, 5, 1, 5, 1])).toBe(100);
    expect(susScore([1, 5, 1, 5, 1, 5, 1, 5, 1, 5])).toBe(0);
  });

  it("scores the neutral answer at 50", () => {
    expect(susScore(Array.from({ length: SUS_ITEMS }, () => 3))).toBe(50);
  });

  it("refuses anything but ten answers", () => {
    expect(() => susScore([3, 3])).toThrow();
  });
});

describe("the study's phases", () => {
  it("runs each task before its own SUS, between the intro and the end", () => {
    expect(STUDY_PHASES[0]).toEqual({ kind: "intro" });
    expect(STUDY_PHASES[1]).toEqual({ kind: "background" });
    const tasks = STUDY_PHASES.filter((phase) => phase.kind === "task");
    const sus = STUDY_PHASES.filter((phase) => phase.kind === "sus");
    expect(tasks.map((phase) => phase.kind === "task" && phase.test)).toEqual(
      STUDY_TESTS.map((_, test) => test),
    );
    tasks.forEach((task, i) => {
      const at = STUDY_PHASES.indexOf(task);
      expect(STUDY_PHASES[at + 1]).toEqual({ kind: "sus", test: i });
    });
    expect(sus).toHaveLength(STUDY_TESTS.length);
    expect(STUDY_PHASES[STUDY_PHASES.length - 1]).toEqual({ kind: "end" });
  });

  it("shows the shortcuts once, right before the first task that has them", () => {
    const helps = STUDY_PHASES.map(
      (phase, at) => [phase.kind, at] as const,
    ).filter(([kind]) => kind === "help");
    expect(helps).toHaveLength(1);
    const first = STUDY_TESTS.findIndex((test) => test.shortcuts);
    expect(STUDY_PHASES[helps[0][1] + 1]).toEqual({
      kind: "task",
      test: first,
    });
    expect(
      STUDY_TESTS.filter((test) => test.shortcuts).map((test) => test.id),
    ).toEqual(["groups"]);
  });
});
