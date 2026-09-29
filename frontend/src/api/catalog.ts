/**
 * `/api/catalog/` — the catalogue the staff pages show, and the staff of each scope.
 *
 * The shapes mirror apps/catalog/serializers.py, which is the single source;
 * tests/test_catalog_contract.py fails when a field is added or renamed on one
 * side only, or when a permission name differs from apps/roles/registry.py.
 * What the caller may do is read from each row — `permissions` and
 * `can_set_current` — and never worked out from a role name here.
 */

import { request } from "./http";

/** A permission of apps/roles/registry.py, `<scope>.<action>`. */
export type Permission =
  | "programme.view"
  | "programme.assign_secretariat"
  | "edition.view"
  | "edition.set_current"
  | "edition.assign_teacher";

export interface Course {
  code: string;
  name: string;
  /** The language the name is written in: the name is data and is shown as it is. */
  locale: string;
}

export interface Programme {
  code: string;
  name: string;
  locale: string;
  permissions: Permission[];
}

export interface StaffMember {
  id: number;
  username: string;
}

export interface Edition {
  id: number;
  course: Course;
  academic_year: string;
  is_current: boolean;
  /** By username. */
  teachers: StaffMember[];
  permissions: Permission[];
  /**
   * Whether a switch by the caller to this edition would pass, both checks
   * included (apps/roles/scopes.py). True on the current edition too, where a
   * switch changes nothing: whether to offer it there is the page's call.
   */
  can_set_current: boolean;
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

/** Every edition in the caller's scope, or only the courses `programme` offers. */
export function listEditions(programme?: string): Promise<Edition[]> {
  const query = programme === undefined ? "" : `?${new URLSearchParams({ programme })}`;
  return request<Edition[]>(`${CATALOG}/editions${query}`);
}

export function readEdition(id: number): Promise<Edition> {
  return request<Edition>(`${CATALOG}/editions/${id}`);
}

/** Makes the edition its course's current one; the answer is the edition, now current. */
export function setCurrent(id: number): Promise<Edition> {
  return request<Edition>(`${CATALOG}/editions/${id}/set-current`, { method: "POST" });
}

function membersPath(scope: MemberScope): string {
  return scope.kind === "edition"
    ? `${CATALOG}/editions/${scope.id}/teachers`
    : `${CATALOG}/programmes/${encodeURIComponent(scope.code)}/secretariat`;
}

export function listMembers(scope: MemberScope): Promise<StaffMember[]> {
  return request<StaffMember[]>(membersPath(scope));
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
