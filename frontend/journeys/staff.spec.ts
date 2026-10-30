/**
 * What is done on the staff pages, as the person it reaches finds it. A role
 * granted: the scoped permission check, the role row and the teacher's own
 * list are all the server's (apps/roles/). Material uploaded: the file
 * stored, its ingest run on the worker over the journeys' stub pipeline
 * (tests/journeys/ingest.py), the row read again until it is ready, and the
 * file served to a student whose answer lists it among its sources.
 */

import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import it from "../src/i18n/it.json" with { type: "json" };
import { ask, logIn, newAccount, SECRETARIAT, STUDENT } from "./stack";

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

test("the secretariat uploads a PDF to an edition, and once it is ready a student's answer opens it", async ({
  page,
  browser,
}) => {
  // The run's first ingest imports docling, about ten seconds on a laptop.
  test.setTimeout(60_000);
  // Bytes of its own, so a retry against the run's database is not a 409.
  const name = `journey-${randomUUID().slice(0, 8)}.pdf`;
  const bytes = Buffer.from(`%PDF-1.4\n% ${name}\n%%EOF\n`);
  await page.goto("/staff/courses/B003370");
  await page.getByRole("link", { name: "2026-2027" }).click();
  await page.getByRole("tab", { name: it.staff.materials.title }).click();
  await page
    .locator('input[type="file"]')
    .setInputFiles({ name, mimeType: "application/pdf", buffer: bytes });
  // Queued, then each step on the worker, read again every 2.5 s.
  const row = page.getByRole("row").filter({ hasText: name });
  await expect(row.getByText(it.staff.materials.status.ready)).toBeVisible({ timeout: 30_000 });

  const own = await browser.newContext({ storageState: STUDENT });
  const student = await own.newPage();
  await student.goto("/");
  await ask(student, `Che cos'è il test di Turing? ${randomUUID().slice(0, 8)}`);
  await student.getByRole("button", { name: new RegExp(`^${it.sources.title} \\(`) }).click();
  const source = student
    .getByRole("dialog")
    .locator("li")
    .filter({ hasText: name })
    .locator('a[href^="/api/sources/"]');
  const href = (await source.getAttribute("href")) ?? "";
  const served = await student.request.get(href.split("#")[0] ?? "");
  expect(served.status()).toBe(200);
  expect(await served.body()).toEqual(bytes);
  await own.close();
});
