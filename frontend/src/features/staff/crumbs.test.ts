/** The breadcrumb of each staff page, from each Gestione root. */

import { describe, expect, it } from "vitest";
import type { Crumb } from "@/components/ui/breadcrumb";
import i18n from "@/i18n";
import { crumbs, type StaffPage } from "./crumbs";
import type { ManagementKey } from "./landing";

const B047 = { code: "B047", name: "INGEGNERIA INFORMATICA", locale: "it" };
const t = i18n.getFixedT("it");

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
      [
        { label: "Corsi di laurea", to: "/staff/programmes" },
        { label: "B047 · INGEGNERIA INFORMATICA" },
      ],
    ],
    [
      // No page above it, so its root is a label and not a link.
      "the one programme of its secretariat",
      { kind: "programme", programme: B047 },
      "programme",
      [{ label: "Corso di laurea" }, { label: "B047 · INGEGNERIA INFORMATICA" }],
    ],
    ["a page that is not there", { kind: "notFound" }, "programme", [{ label: "Non trovato" }]],
  ])("of %s", (_, page, root, expected) => {
    expect(crumbs(page, root, t)).toEqual(expected);
  });
});
