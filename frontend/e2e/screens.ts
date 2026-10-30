/**
 * Every screen of `src/App.tsx`, as the reader who can open it sees it.
 *
 * `/` is here twice because a visitor and a signed-in reader get different
 * layouts on it. `/staff` itself is left out: it only redirects to the first
 * staff page the account holds, which is listed.
 */

import type { Page } from "@playwright/test";

import it from "../src/i18n/it.json" with { type: "json" };
import { type Api, expect } from "./api";
import {
  ADMIN,
  CONVERSATION,
  COURSE,
  LINK_TOKEN,
  PROGRAMME,
  RATING,
  STAFF,
  STUDENT,
} from "./fixtures";

export interface Screen {
  path: string;
  /** The address's fragment, `#` and all: the token of a link a page opens. */
  hash?: string;
  as: "visitor" | "student" | "staff" | "admin";
  /** An element only this screen, fully drawn, shows, by its role and its exact name. */
  mark: { role: "heading" | "button" | "link"; name: string };
}

const heading = (name: string) => ({ role: "heading", name }) as const;

export const SCREENS: Screen[] = [
  // The two forms share their page heading; their buttons tell them apart.
  { path: "/login", as: "visitor", mark: { role: "button", name: it.auth.logIn } },
  { path: "/register", as: "visitor", mark: { role: "button", name: it.auth.register } },
  // The pages of a forgotten password and of a link: the last two once it is looked up.
  { path: "/forgot", as: "visitor", mark: { role: "link", name: it.auth.backToLogIn } },
  {
    path: "/reset",
    hash: `#${LINK_TOKEN}`,
    as: "visitor",
    mark: { role: "button", name: it.auth.resetSubmit },
  },
  {
    path: "/invite",
    hash: `#${LINK_TOKEN}`,
    as: "visitor",
    mark: { role: "button", name: it.auth.acceptAndRegister },
  },
  { path: "/styleguide", as: "visitor", mark: heading("Component catalogue") },
  { path: "/", as: "visitor", mark: heading(it.entry.caption) },
  { path: "/", as: "student", mark: heading(it.entry.caption) },
  {
    path: `/chat/${CONVERSATION.id}`,
    as: "student",
    mark: { role: "button", name: it.answer.copy },
  },
  // Its devices are the last section to arrive.
  { path: "/account", as: "student", mark: heading(it.account.sessions.title) },
  { path: "/staff/programmes", as: "staff", mark: heading(it.staff.programmes.title) },
  { path: `/staff/programmes/${PROGRAMME.code}`, as: "staff", mark: heading(PROGRAMME.name) },
  // A course and its editions share the course's name as their title; an
  // edition's own mark is the heading of its syllabus's first section, shown
  // once the syllabus is read.
  { path: `/staff/courses/${COURSE.code}`, as: "staff", mark: heading(COURSE.name) },
  {
    path: "/staff/editions/11",
    as: "staff",
    mark: heading(it.staff.syllabus.section.obiettivi_formativi),
  },
  // The one the reader may not assign on, with the read-only banner.
  {
    path: "/staff/editions/12",
    as: "staff",
    mark: heading(it.staff.syllabus.section.obiettivi_formativi),
  },
  { path: "/staff/mine", as: "staff", mark: heading(it.staff.mine.title) },
  { path: "/staff/users", as: "admin", mark: heading(it.staff.users.title) },
  { path: "/staff/feedback", as: "admin", mark: heading(it.staff.feedback.title) },
  {
    path: `/staff/feedback/${RATING.id}`,
    as: "admin",
    mark: heading(it.staff.feedback.answer),
  },
  { path: "/staff/nowhere", as: "staff", mark: heading(it.staff.refusal.notFound) },
  { path: "/nowhere", as: "visitor", mark: heading(it.notFound.title) },
];

/**
 * Opens `screen` and waits until it is the screen named, drawn and settled.
 *
 * The mark and the address are checked rather than trusted: a guard that sent
 * the reader elsewhere, or a page stuck loading, would otherwise have the floors
 * judge some other screen and pass. The address is read last, once the network
 * is quiet: every redirect waits for `/api/auth/me`, so read straight after
 * `goto` it would still be the one asked for.
 *
 * The entry is judged at rest, its intro already seen: the intro plays on a
 * visitor's first visit only (src/features/entry/intro.ts), and motion.spec.ts
 * checks that first visit on its own.
 */
export async function visit(page: Page, api: Api, screen: Screen): Promise<void> {
  await page.addInitScript(() => localStorage.setItem("mca.intro", "seen"));
  if (screen.as === "student") {
    api.signIn(STUDENT);
    api.conversation(CONVERSATION);
  } else if (screen.as === "staff") {
    api.signIn(STAFF);
    api.catalog();
  } else if (screen.as === "admin") {
    api.signIn(ADMIN);
    api.catalog();
    api.users();
    api.feedback();
  }
  await page.goto(screen.path + (screen.hash ?? ""));
  const { role, name } = screen.mark;
  await expect(page.getByRole(role, { name, exact: true }).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).pathname, "where the screen ended up").toBe(screen.path);
}
