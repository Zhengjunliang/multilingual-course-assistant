/**
 * `/api/catalog/` — the catalogue the staff pages show, and the staff of each scope.
 *
 * The shapes mirror apps/catalog/serializers.py, which is the single source;
 * tests/test_catalog_contract.py fails when a field is added or renamed on one
 * side only, or when a permission name, a code source or an error code differs
 * from the Python side. The test compares each interface's field names with the
 * serializer's, so an interface spells its own fields, never `extends` another,
 * and names a nested shape by its type rather than writing it inline.
 * What the caller may do is read from each row's `permissions`, and never
 * worked out from a role name here.
 */

import type { UiLocale } from "@/i18n";
import { request } from "./http";

/** A permission of apps/roles/registry.py, `<scope>.<action>`. */
export type Permission =
  | "programme.view"
  | "programme.assign_secretariat"
  | "edition.view"
  | "edition.assign_teacher"
  | "edition.edit_content";

/**
 * Where a course's `code` was read from (apps/catalog/models.py): its Moodle
 * course, or, for a course no single Moodle course holds, the Cineca catalogue.
 */
export type CodeSource = "moodle" | "cineca-only";

/** A programme as a curriculum entry names it. */
export interface ProgrammeName {
  code: string;
  name: string;
  locale: string;
}

/** A programme's study plan lists a course in one curriculum, in one year of study. */
export interface CurriculumEntry {
  programme: ProgrammeName;
  /** As the Cineca catalogue prints it; empty when the programme has no curricula. */
  curriculum: string;
  year_of_study: number;
  ad_code: string;
}

export interface Course {
  code: string;
  name: string;
  /** The language the name is written in: the name is data and is shown as it is. */
  locale: string;
  code_source: CodeSource;
  /** Its entries in every programme that lists it, by programme code: the study plans are public. */
  entries: CurriculumEntry[];
}

export interface Programme {
  code: string;
  name: string;
  locale: string;
  /** Its curricula's names, sorted; empty when it has none. */
  curricula: string[];
  /** The courses its study plan lists, each once however many curricula list it. */
  course_count: number;
  /** By username. */
  secretariat: StaffMember[];
  permissions: Permission[];
}

export interface StaffMember {
  id: number;
  username: string;
  /** The account's full name; empty when it has none, and the username stands alone. */
  name: string;
}

export interface Edition {
  id: number;
  course: Course;
  academic_year: string;
  /** The first day of its teaching, `YYYY-MM-DD`; null when nobody entered it. */
  teaching_starts: string | null;
  /**
   * Whether it is its course's current edition today: the newest one whose
   * teaching has started (apps/catalog/editions.py). Nobody sets it.
   */
  is_current: boolean;
  /** By username. */
  teachers: StaffMember[];
  permissions: Permission[];
}

/** An edition as a study plan row shows it. */
export interface EditionSummary {
  id: number;
  academic_year: string;
  /** By username. */
  teachers: StaffMember[];
}

/** A row of a programme's study plan: one course, and its current edition when it has one. */
export interface StudyPlanCourse {
  course: Course;
  current_edition: EditionSummary | null;
}

/** A section of a UniFi syllabus, in the order the Cineca course catalogue shows them. */
export type SyllabusSectionKey =
  | "obiettivi_formativi"
  | "prerequisiti"
  | "contenuti"
  | "programma_esteso"
  | "metodi_didattici"
  | "verifica_apprendimento"
  | "altro";

/** One section of an edition's syllabus in one language; a section with no text has no row. */
export interface SyllabusSection {
  locale: UiLocale;
  section: SyllabusSectionKey;
  text: string;
}

/** How a reading list holds a book. */
export type Importance = "required" | "recommended";

/** A book on an edition's reading list, in the language its entry is written in. */
export interface ReadingItem {
  id: number;
  locale: UiLocale;
  title: string;
  /** As the syllabus prints them. */
  authors: string;
  year: number | null;
  /** Empty when the list gives none. */
  isbn: string;
  /** Empty when the list gives none. */
  url: string;
  importance: Importance;
}

/**
 * The codes a staff page has words for (apps/catalog/errors.py): this
 * project's own, a closed set, and the few of DRF's the pages name. DRF's codes
 * are not a closed set, so any other one gets a general sentence.
 */
export type StaffErrorCode =
  | "no_such_user"
  | "already_held"
  | "required"
  | "blank"
  | "not_authenticated"
  | "permission_denied"
  | "not_found"
  | "max_length"
  | "invalid"
  | "invalid_choice"
  | "min_value"
  | "max_value"
  | "unique";

/** Where staff members belong: an edition's teachers, or a programme's secretariat. */
export type MemberScope = { kind: "edition"; id: number } | { kind: "programme"; code: string };

const CATALOG = "/api/catalog";

export function listProgrammes(): Promise<Programme[]> {
  return request<Programme[]>(`${CATALOG}/programmes`);
}

export function readProgramme(code: string): Promise<Programme> {
  return request<Programme>(`${CATALOG}/programmes/${encodeURIComponent(code)}`);
}

/** The programme's study plan, each course once, by code. */
export function listStudyPlan(code: string): Promise<StudyPlanCourse[]> {
  return request<StudyPlanCourse[]>(`${CATALOG}/programmes/${encodeURIComponent(code)}/courses`);
}

/** A course a programme the caller may view lists; 404 for any other. */
export function readCourse(code: string): Promise<Course> {
  return request<Course>(`${CATALOG}/courses/${encodeURIComponent(code)}`);
}

/** Every edition in the caller's scope, or only one course's. */
export function listEditions(filter: { course?: string } = {}): Promise<Edition[]> {
  const query =
    filter.course === undefined ? "" : `?${new URLSearchParams({ course: filter.course })}`;
  return request<Edition[]>(`${CATALOG}/editions${query}`);
}

export function readEdition(id: number): Promise<Edition> {
  return request<Edition>(`${CATALOG}/editions/${id}`);
}

/** Where a scope's members are added; they are read on the scope itself, `teachers` or `secretariat`. */
function membersPath(scope: MemberScope): string {
  return scope.kind === "edition"
    ? `${CATALOG}/editions/${scope.id}/teachers`
    : `${CATALOG}/programmes/${encodeURIComponent(scope.code)}/secretariat`;
}

/** Names an existing user by their exact username; the server answers 201 with the member. */
export function addMember(scope: MemberScope, username: string): Promise<StaffMember> {
  return request<StaffMember>(membersPath(scope), {
    method: "POST",
    body: JSON.stringify({ username }),
  });
}

/** The server answers 204, or 404 when the member was removed elsewhere first. */
export function removeMember(scope: MemberScope, username: string): Promise<void> {
  return request<void>(`${membersPath(scope)}/${encodeURIComponent(username)}`, {
    method: "DELETE",
  });
}
