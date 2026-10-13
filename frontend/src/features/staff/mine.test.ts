/** Which editions a teacher's own courses list, in each view. */

import { describe, expect, it } from "vitest";

import type { Course, Edition } from "@/api/catalog";
import { notOver, ownCourses, shown } from "./mine";

function course(code: string): Course {
  return { code, name: code, locale: "it", code_source: "moodle", entries: [] };
}

function edition(
  id: number,
  code: string,
  year: string,
  current: boolean,
  teachers: string[],
): Edition {
  return {
    id,
    course: course(code),
    academic_year: year,
    teaching_starts: null,
    is_current: current,
    teachers: teachers.map((username, index) => ({ id: index, username, name: "" })),
    permissions: ["edition.view"],
  };
}

const ids = (editions: readonly Edition[]) => editions.map((edition) => edition.id);

describe("a teacher's own courses", () => {
  it("lists every year of a course taught in one, newest first, and no course taught in none", () => {
    const editions = [
      edition(1, "B1", "2024-2025", false, []),
      edition(2, "B2", "2026-2027", false, ["other"]),
      edition(3, "B1", "2026-2027", false, []),
      edition(4, "B1", "2025-2026", true, ["me"]),
    ];

    expect(ownCourses(editions, "me").map(ids)).toEqual([[3, 4, 1]]);
  });

  it("keeps the courses in the list's order", () => {
    const editions = [
      edition(1, "B2", "2025-2026", true, ["me"]),
      edition(2, "B1", "2025-2026", true, ["me"]),
    ];

    expect(ownCourses(editions, "me").map(ids)).toEqual([[1], [2]]);
  });
});

describe("the editions that are not over", () => {
  // Each group newest first, as ownCourses returns it.
  it.each<[string, [string, boolean][], string[]]>([
    [
      "the current one and the newer, not the older",
      [
        ["2026-2027", false],
        ["2025-2026", true],
        ["2024-2025", false],
      ],
      ["2026-2027", "2025-2026"],
    ],
    [
      "the current one when it is the newest",
      [
        ["2026-2027", true],
        ["2025-2026", false],
      ],
      ["2026-2027"],
    ],
    [
      "the newest when none has started",
      [
        ["2026-2027", false],
        ["2025-2026", false],
      ],
      ["2026-2027"],
    ],
  ])("are %s", (_, years, expected) => {
    const group = years.map(([year, current], index) => edition(index, "B1", year, current, []));

    expect(notOver(group).map((e) => e.academic_year)).toEqual(expected);
  });
});

describe("the view a link names", () => {
  it.each([
    ["all", "all"],
    [null, "current"],
    ["current", "current"],
    ["tutte", "current"],
  ])("reads ?show=%s as %s", (value, expected) => {
    expect(shown(value)).toBe(expected);
  });
});
