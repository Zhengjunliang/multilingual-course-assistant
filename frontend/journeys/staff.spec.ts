/**
 * A role granted on the staff pages, as the person it is granted to finds it:
 * the scoped permission check, the role row and the teacher's own list are
 * all the server's (apps/roles/).
 */

import { expect, test } from "@playwright/test";
import it from "../src/i18n/it.json" with { type: "json" };
import { logIn, newAccount, SECRETARIAT } from "./stack";

test.use({ storageState: SECRETARIAT });

test("the secretariat assigns a teacher to an edition, and the teacher finds it among theirs", async ({
  page,
  browser,
  baseURL,
}) => {
  const teacher = await newAccount(baseURL ?? "");
  // Sistemi operativi, in B047, which demo-secretariat runs.
  await page.goto("/staff/courses/B003370");
  await page.getByRole("link", { name: "2026-2027" }).click();
  await page.getByRole("button", { name: it.staff.assign.teacher }).click();
  await page.getByLabel(it.staff.assign.username).fill(teacher);
  await page.getByRole("button", { name: it.staff.assign.submit }).click();
  await expect(page.getByText(it.staff.assign.doneTeacher)).toBeVisible();

  // The teacher's own browser. Its storage is emptied: a context made inside
  // a test takes the project's options, the secretariat's session among them.
  const own = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const mine = await own.newPage();
  await logIn(mine, teacher);
  await mine.goto("/staff/mine?show=all");
  await expect(mine.getByRole("link", { name: "SISTEMI OPERATIVI · 2026-2027" })).toBeVisible();
  await own.close();
});
