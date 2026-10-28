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

/** When in the academic year an edition is taught: the Cineca catalogue's semesters. */
export type TeachingPeriod = "first_semester" | "second_semester";

export interface Edition {
  id: number;
  course: Course;
  academic_year: string;
  /** The first day of its teaching, `YYYY-MM-DD`; null when nobody entered it. */
  teaching_starts: string | null;
  /** Empty when nobody entered it. */
  period: TeachingPeriod | "";
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

/** One section of an edition's syllabus, its text in Markdown; a section with no text has no row. */
export interface SyllabusSection {
  section: SyllabusSectionKey;
  /** CommonMark with GitHub's extensions. */
  text: string;
}

/** An edition's syllabus: the one language every section is written in, and the sections. */
export interface Syllabus {
  locale: UiLocale;
  /** In the catalogue's order; an empty section is not listed. */
  sections: SyllabusSection[];
}

/**
 * The languages a book may be written in: the tags of Django's own table
 * (`django.conf.global_settings.LANGUAGES`), which the server checks a book's
 * against. tests/test_catalog_contract.py holds this list inside that table,
 * so the form never offers a tag the server would refuse; a language a later
 * Django adds is offered once it is added here.
 */
export const BOOK_LANGUAGES = [
  "af",
  "ar",
  "ar-dz",
  "ast",
  "az",
  "bg",
  "be",
  "bn",
  "br",
  "bs",
  "ca",
  "ckb",
  "cs",
  "cy",
  "da",
  "de",
  "dsb",
  "el",
  "en",
  "en-au",
  "en-gb",
  "eo",
  "es",
  "es-ar",
  "es-co",
  "es-mx",
  "es-ni",
  "es-ve",
  "et",
  "eu",
  "fa",
  "fi",
  "fr",
  "fy",
  "ga",
  "gd",
  "gl",
  "he",
  "hi",
  "hr",
  "hsb",
  "hu",
  "hy",
  "ia",
  "id",
  "ig",
  "io",
  "is",
  "it",
  "ja",
  "ka",
  "kab",
  "kk",
  "km",
  "kn",
  "ko",
  "ky",
  "lb",
  "lt",
  "lv",
  "mk",
  "ml",
  "mn",
  "mr",
  "ms",
  "my",
  "nb",
  "ne",
  "nl",
  "nn",
  "os",
  "pa",
  "pl",
  "pt",
  "pt-br",
  "ro",
  "ru",
  "sk",
  "sl",
  "sq",
  "sr",
  "sr-latn",
  "sv",
  "sw",
  "ta",
  "te",
  "tg",
  "th",
  "tk",
  "tr",
  "tt",
  "udm",
  "ug",
  "uk",
  "ur",
  "uz",
  "vi",
  "zh-hans",
  "zh-hant",
] as const;

/** How a reading list holds a book. */
export type Importance = "required" | "recommended";

/** A book on an edition's reading list. */
export interface ReadingItem {
  id: number;
  /** The language the book is written in, a BCP 47 tag Django knows (`en`, `de`). */
  locale: string;
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
 * A book as the reading list's form sends it, every field but the id; the
 * year as typed, which the server reads as a number or refuses with `invalid`.
 */
export interface ReadingDraft {
  locale: string;
  title: string;
  authors: string;
  year: string | null;
  isbn: string;
  url: string;
  importance: Importance;
}

/** A course as an invitation names it (apps/catalog/invitation_serializers.py): no entries. */
export interface CourseName {
  code: string;
  name: string;
  locale: string;
}

/** An edition as an invitation names it: its course and its year. */
export interface EditionName {
  id: number;
  course: CourseName;
  academic_year: string;
}

/** The role an invitation grants: on an edition for a teacher, on a programme for the secretariat. */
export type InvitedRole = "teacher" | "secretariat";

/**
 * A row of a scope's invitations, or of every scope's. `edition` is null on a
 * secretariat invitation and `programme` on a teacher's; past `expires_at` it
 * no longer works, and stays listed until revoked.
 */
export interface Invitation {
  id: number;
  role: InvitedRole;
  edition: EditionName | null;
  programme: ProgrammeName | null;
  /** By username. */
  created_by: string;
  created_at: string;
  expires_at: string;
}

/** An invitation just made: its row, and the one time its token is shown. */
export interface NewInvitation {
  id: number;
  role: InvitedRole;
  edition: EditionName | null;
  programme: ProgrammeName | null;
  created_by: string;
  created_at: string;
  expires_at: string;
  token: string;
}

/** What an invitation makes its holder, for the page it is opened on. */
export interface InvitationGrant {
  role: InvitedRole;
  edition: EditionName | null;
  programme: ProgrammeName | null;
}

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

/** Where an invitation is made, listed and revoked: under the scope whose role it grants. */
function invitationsPath(scope: MemberScope): string {
  return scope.kind === "edition"
    ? `${CATALOG}/editions/${scope.id}/invitations`
    : `${CATALOG}/programmes/${encodeURIComponent(scope.code)}/invitations`;
}

/** The scope an invitation grants its role on. */
export function invitationScope(invitation: Invitation): MemberScope {
  return invitation.edition !== null
    ? { kind: "edition", id: invitation.edition.id }
    : { kind: "programme", code: invitation.programme?.code ?? "" };
}

/** The scope's invitations not accepted yet, the expired too, oldest first. */
export function listInvitations(scope: MemberScope): Promise<Invitation[]> {
  return request<Invitation[]>(invitationsPath(scope));
}

/** Every scope's, for the superuser. */
export function listAllInvitations(): Promise<Invitation[]> {
  return request<Invitation[]>(`${CATALOG}/invitations`);
}

/** The server answers 201 with the invitation and the one time its token is shown. */
export function createInvitation(scope: MemberScope): Promise<NewInvitation> {
  return request<NewInvitation>(invitationsPath(scope), { method: "POST" });
}

/** The server answers 204, or 404 when it was accepted or revoked elsewhere first. */
export function revokeInvitation(invitation: Invitation): Promise<void> {
  return request<void>(`${invitationsPath(invitationScope(invitation))}/${invitation.id}`, {
    method: "DELETE",
  });
}

/** The edition's syllabus: its language and its sections, in the catalogue's order. */
export function readSyllabus(edition: number): Promise<Syllabus> {
  return request<Syllabus>(`${CATALOG}/editions/${edition}/syllabus`);
}

/** Sets the language the syllabus is written in; the text is not touched. Answers with the syllabus. */
export function setSyllabusLocale(edition: number, locale: UiLocale): Promise<Syllabus> {
  return request<Syllabus>(`${CATALOG}/editions/${edition}/syllabus`, {
    method: "PATCH",
    body: JSON.stringify({ locale }),
  });
}

/**
 * Writes one section's Markdown and answers with it; a text blank once
 * trimmed clears the section, which the server answers with 204, here `null`.
 */
export async function writeSyllabus(
  edition: number,
  section: SyllabusSectionKey,
  text: string,
): Promise<SyllabusSection | null> {
  const written = await request<SyllabusSection | undefined>(
    `${CATALOG}/editions/${edition}/syllabus/${section}`,
    { method: "PUT", body: JSON.stringify({ text }) },
  );
  return written ?? null;
}

/** The edition's books, by title. */
export function listReadings(edition: number): Promise<ReadingItem[]> {
  return request<ReadingItem[]>(`${CATALOG}/editions/${edition}/readings`);
}

/** The server answers 201 with the book. */
export function addReading(edition: number, book: ReadingDraft): Promise<ReadingItem> {
  return request<ReadingItem>(`${CATALOG}/editions/${edition}/readings`, {
    method: "POST",
    body: JSON.stringify(book),
  });
}

/** Writes the fields `changes` names and answers with the whole book; 404 when it was removed elsewhere first. */
export function changeReading(
  edition: number,
  id: number,
  changes: Partial<ReadingDraft>,
): Promise<ReadingItem> {
  return request<ReadingItem>(`${CATALOG}/editions/${edition}/readings/${id}`, {
    method: "PATCH",
    body: JSON.stringify(changes),
  });
}

/** The server answers 204, or 404 when the book was removed elsewhere first. */
export function removeReading(edition: number, id: number): Promise<void> {
  return request<void>(`${CATALOG}/editions/${edition}/readings/${id}`, { method: "DELETE" });
}
