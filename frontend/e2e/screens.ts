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
  /** A heading only this screen, fully drawn, shows. */
  heading: string;
}

export const SCREENS: Screen[] = [
  { path: "/login", as: "visitor", heading: it.app.title },
  { path: "/register", as: "visitor", heading: it.app.title },
  { path: "/styleguide", as: "visitor", heading: "Component catalogue" },
  { path: "/", as: "visitor", heading: it.empty.title },
  { path: "/", as: "student", heading: it.empty.title },
  { path: `/c/${CONVERSATION.id}`, as: "student", heading: it.citations.title },
  { path: "/staff/programmes", as: "staff", heading: it.staff.programmes.title },
  { path: `/staff/programmes/${PROGRAMME.code}`, as: "staff", heading: PROGRAMME.name },
  { path: `/staff/courses/${COURSE.code}`, as: "staff", heading: COURSE.name },
  { path: "/staff/editions/11", as: "staff", heading: COURSE.name },
  { path: "/staff/mine", as: "staff", heading: it.staff.mine.title },
  { path: "/staff/nowhere", as: "staff", heading: it.staff.refusal.notFound },
  { path: "/nowhere", as: "visitor", heading: it.notFound.title },
];

/**
 * Opens `screen` and waits until it is the screen named, drawn and settled.
 *
 * The address and the heading are checked rather than trusted: a guard that
 * sent the reader elsewhere, or a page stuck loading, would otherwise have the
 * floors judge some other screen and pass.
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
  await expect.poll(() => new URL(page.url()).pathname).toBe(screen.path);
  await expect(page.getByRole("heading", { name: screen.heading }).first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await page.waitForLoadState("networkidle");
}
