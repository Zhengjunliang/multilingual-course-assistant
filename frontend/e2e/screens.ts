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
import { CONVERSATION, COURSE, PROGRAMME, STAFF, STUDENT } from "./fixtures";

export interface Screen {
  path: string;
  as: "visitor" | "student" | "staff";
  /** An element only this screen, fully drawn, shows, by its role and its exact name. */
  mark: { role: "heading" | "button"; name: string };
}

const heading = (name: string) => ({ role: "heading", name }) as const;

export const SCREENS: Screen[] = [
  // The two forms share their page heading; their buttons tell them apart.
  { path: "/login", as: "visitor", mark: { role: "button", name: it.auth.logIn } },
  { path: "/register", as: "visitor", mark: { role: "button", name: it.auth.register } },
  { path: "/styleguide", as: "visitor", mark: heading("Component catalogue") },
  { path: "/", as: "visitor", mark: heading(it.empty.title) },
  { path: "/", as: "student", mark: heading(it.empty.title) },
  { path: `/c/${CONVERSATION.id}`, as: "student", mark: heading(it.citations.title) },
  { path: "/staff/programmes", as: "staff", mark: heading(it.staff.programmes.title) },
  { path: `/staff/programmes/${PROGRAMME.code}`, as: "staff", mark: heading(PROGRAMME.name) },
  // A course and its edition share the course's name as their title.
  { path: `/staff/courses/${COURSE.code}`, as: "staff", mark: heading(it.staff.course.editions) },
  { path: "/staff/editions/11", as: "staff", mark: heading(it.staff.edition.teachers) },
  { path: "/staff/mine", as: "staff", mark: heading(it.staff.mine.title) },
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
 */
export async function visit(page: Page, api: Api, screen: Screen): Promise<void> {
  if (screen.as === "student") {
    api.signIn(STUDENT);
    api.conversation(CONVERSATION);
  } else if (screen.as === "staff") {
    api.signIn(STAFF);
    api.catalog();
  }
  await page.goto(screen.path);
  const { role, name } = screen.mark;
  await expect(page.getByRole(role, { name, exact: true }).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForLoadState("networkidle");
  expect(new URL(page.url()).pathname, "where the screen ended up").toBe(screen.path);
}
