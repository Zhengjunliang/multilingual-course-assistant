/** The breadcrumb of each staff page, from each Gestione root, and the path a course is reached through. */

import { describe, expect, it } from "vitest";

import type { CurriculumEntry } from "@/api/catalog";
import type { Crumb } from "@/components/ui/breadcrumb";
import i18n from "@/i18n";
import { contextProgramme, crumbs, programmeLine, type StaffPage } from "./crumbs";
import type { ManagementKey } from "./landing";

const B047 = { code: "B047", name: "INGEGNERIA INFORMATICA", locale: "it" };
const B222 = { code: "B222", name: "INGEGNERIA GESTIONALE", locale: "it" };
const PPM = { code: "B028451", name: "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE" };
const t = i18n.getFixedT("it");

const LIST = { label: "Corsi di laurea", to: "/staff/programmes" };
const ONE = { label: "Corso di laurea" };
const AT_B047 = { label: "B047 · INGEGNERIA INFORMATICA", to: "/staff/programmes/B047" };

describe("a staff page's breadcrumb", () => {
  it.each<[string, StaffPage, ManagementKey | null, Crumb[]]>([
    [
      "the list of programmes",
      { kind: "programmes" },
      "programmes",
      [{ label: "Corsi di laurea" }],
    ],
    [
      "a programme, reached from the list",
      { kind: "programme", programme: B047 },
      "programmes",
      [LIST, AT_B047],
    ],
    // No page above it, so its root is a label and not a link.
    [
      "the one programme of its secretariat",
      { kind: "programme", programme: B047 },
      "programme",
      [ONE, AT_B047],
    ],
    [
      "a course, through its programme",
      { kind: "course", course: PPM, programme: B047 },
      "programme",
      [ONE, AT_B047, { label: PPM.name }],
    ],
    [
      "an edition, through its programme and course",
      { kind: "edition", course: PPM, year: "2025-2026", programme: B047 },
      "programmes",
      [
        LIST,
        AT_B047,
        { label: PPM.name, to: "/staff/courses/B028451?programme=B047" },
        { label: "2025-2026" },
      ],
    ],
    [
      "an edition no programme of the reader lists, under their own courses",
      { kind: "edition", course: PPM, year: "2025-2026", programme: null },
      "mine",
      [
        { label: "I miei insegnamenti", to: "/staff/mine" },
        { label: "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE · 2025-2026" },
      ],
    ],
    ["a teacher's own courses", { kind: "mine" }, "mine", [{ label: "I miei insegnamenti" }]],
    ["a page that is not there", { kind: "notFound" }, "programme", [{ label: "Non trovato" }]],
    [
      "a page not there, for a teacher",
      { kind: "notFound" },
      "mine",
      [{ label: "I miei insegnamenti", to: "/staff/mine" }, { label: "Non trovato" }],
    ],
  ])("of %s", (_, page, root, expected) => {
    expect(crumbs(page, root, t)).toEqual(expected);
  });
});

describe("the programme a course is reached through", () => {
  const entries: CurriculumEntry[] = [
    { programme: B047, curriculum: "TECNICO APPLICATIVO", year_of_study: 1, ad_code: "B000001" },
    { programme: B047, curriculum: "TECNICO SCIENTIFICO", year_of_study: 1, ad_code: "B000001" },
    { programme: B222, curriculum: "PROFESSIONALIZZANTE", year_of_study: 1, ad_code: "B000001" },
  ];

  it.each([
    ["the one the link names", "B222", [B047, B222], "B222"],
    ["the first the reader may view, when the link names none", null, [B047, B222], "B047"],
    ["the first the reader may view, when it names one they may not", "B222", [B047], "B047"],
    ["none, for a reader who views none", "B047", [], null],
  ])("is %s", (_, wanted, visible, code) => {
    expect(contextProgramme(entries, wanted, visible)?.code ?? null).toBe(code);
  });

  it("names every programme that lists it, once, in the reader's language", () => {
    expect(programmeLine(entries, "it")).toBe(
      "INGEGNERIA INFORMATICA · B047 e INGEGNERIA GESTIONALE · B222",
    );
  });
});
