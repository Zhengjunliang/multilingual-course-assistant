/**
 * Every screen of `src/App.tsx`, as the reader who can open it sees it.
 *
 * `/` is here twice because a visitor and a signed-in reader get different
 * layouts on it. `/staff` itself is left out: it only redirects to the first
 * staff page the account holds, which is listed.
 */

import type { Api } from "./api";
import { CONVERSATION, STAFF, STUDENT } from "./fixtures";

export interface Screen {
  path: string;
  as: "visitor" | "student" | "staff";
}

export const SCREENS: Screen[] = [
  { path: "/login", as: "visitor" },
  { path: "/register", as: "visitor" },
  { path: "/styleguide", as: "visitor" },
  { path: "/", as: "visitor" },
  { path: "/", as: "student" },
  { path: `/c/${CONVERSATION.id}`, as: "student" },
  { path: "/staff/programmes", as: "staff" },
  { path: "/staff/programmes/B060", as: "staff" },
  { path: "/staff/courses/B003", as: "staff" },
  { path: "/staff/editions/11", as: "staff" },
  { path: "/staff/mine", as: "staff" },
  { path: "/staff/nowhere", as: "staff" },
  { path: "/nowhere", as: "visitor" },
];

/** The fixtures `screen` reads. */
export function arrange(api: Api, screen: Screen): void {
  if (screen.as === "student") {
    api.signIn(STUDENT);
    api.conversation(CONVERSATION);
  } else if (screen.as === "staff") {
    api.signIn(STAFF);
    api.catalog();
  }
}
