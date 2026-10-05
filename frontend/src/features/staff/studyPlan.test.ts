/** A programme's study plan: grouped, narrowed to a curriculum, searched. */

import { describe, expect, it } from "vitest";

import type { Course, CurriculumEntry, ProgrammeName, StudyPlanCourse } from "@/api/catalog";
import { fold, type PlanGroup, studyPlan } from "./studyPlan";

const B047: ProgrammeName = { code: "B047", name: "INGEGNERIA INFORMATICA", locale: "it" };
const B222: ProgrammeName = { code: "B222", name: "INGEGNERIA GESTIONALE", locale: "it" };
const TA = "TECNICO APPLICATIVO";
const TS = "TECNICO SCIENTIFICO";
const PLAN = { code: "B047", curricula: [TA, TS] };

function entry(programme: ProgrammeName, curriculum: string, year: number, ad: string) {
  return { programme, curriculum, year_of_study: year, ad_code: ad } satisfies CurriculumEntry;
}

function row(code: string, name: string, entries: CurriculumEntry[], cineca = false) {
  const course: Course = {
    code,
    name,
    locale: "it",
    code_source: cineca ? "cineca-only" : "moodle",
    entries,
  };
  return { course, current_edition: null } satisfies StudyPlanCourse;
}

const ROWS = [
  // Two codes, one per curriculum.
  row("B028451", "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE", [
    entry(B047, TA, 3, "B028451"),
    entry(B047, TS, 3, "B003712"),
  ]),
  // One code in both curricula, and in another programme's plan.
  row("B000001", "ANALISI MATEMATICA I", [
    entry(B047, TA, 1, "B000001"),
    entry(B047, TS, 1, "B000001"),
    entry(B222, "PROFESSIONALIZZANTE", 1, "B000001"),
  ]),
  row("B024259", "CALCOLABILITÀ", [entry(B047, TS, 3, "B024259")]),
  row(
    "B003271",
    "GEOMETRIA E ALGEBRA LINEARE/CALCOLO NUMERICO C.I.",
    [entry(B047, TA, 1, "B003271"), entry(B047, TS, 1, "B003271")],
    true,
  ),
];

/** Each group as `year: [code, splitCodes, coverage, others]` per row. */
function shape(groups: PlanGroup[]) {
  return Object.fromEntries(
    groups.map((group) => [
      group.year,
      group.rows.map((r) => [r.course.code, r.splitCodes, r.coverage, r.others.map((p) => p.code)]),
    ]),
  );
}

describe("a study plan", () => {
  it("groups by year of study and says which curricula list each course", () => {
    expect(shape(studyPlan(ROWS, PLAN, null, ""))).toEqual({
      1: [
        ["B000001", false, { kind: "both" }, ["B222"]],
        ["B003271", false, { kind: "both" }, []],
      ],
      3: [
        ["B024259", false, { kind: "only", curricula: [TS] }, []],
        ["B028451", true, null, []],
      ],
    });
  });

  it("narrows to one curriculum's entries, one code each", () => {
    const groups = studyPlan(ROWS, PLAN, TA, "");
    expect(shape(groups)).toEqual({
      1: [
        ["B000001", false, null, ["B222"]],
        ["B003271", false, null, []],
      ],
      3: [["B028451", false, null, []]],
    });
    expect(groups[1]?.rows[0]?.entries.map((e) => e.ad_code)).toEqual(["B028451"]);
  });

  it.each([
    ["a name without its accent", "calcolabilita", ["B024259"]],
    ["a code listed only in one curriculum", "b003712", ["B028451"]],
    ["the course's own code", "B000001", ["B000001"]],
    ["nothing", "zzz", []],
  ])("finds %s", (_, query, codes) => {
    const found = studyPlan(ROWS, PLAN, null, query).flatMap((g) =>
      g.rows.map((r) => r.course.code),
    );
    expect(found).toEqual(codes);
  });

  it("names every curriculum when there are more than two", () => {
    const three = { code: "B222", curricula: ["A", "B", "C"] };
    const all = [
      row(
        "B000009",
        "FISICA",
        ["A", "B", "C"].map((c) => entry(B222, c, 1, "B000009")),
      ),
    ];
    const some = [
      row(
        "B000009",
        "FISICA",
        ["A", "C"].map((c) => entry(B222, c, 1, "B000009")),
      ),
    ];

    expect(studyPlan(all, three, null, "")[0]?.rows[0]?.coverage).toEqual({ kind: "every" });
    expect(studyPlan(some, three, null, "")[0]?.rows[0]?.coverage).toEqual({
      kind: "only",
      curricula: ["A", "C"],
    });
  });

  it("folds accents and case", () => {
    expect(fold("Università È")).toBe("universita e");
  });
});
