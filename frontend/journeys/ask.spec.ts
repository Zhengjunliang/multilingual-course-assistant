/**
 * A question through the real `/api/ask`: the stream, its citations, the
 * conversation stored for an account and the empty history a visitor sends
 * are what the two sides must agree on. The model is the fake of
 * tests/journeys/fake_llm.py, so the answer is always the same one.
 */

import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { ask, PAGE, STUDENT } from "./stack";

const CITED = new RegExp(`^${PAGE.replaceAll(".", "\\.")}`);

test.describe("a signed-in student", () => {
  test.use({ storageState: STUDENT });

  test("is answered with its source, and the stored conversation reopens at its address", async ({
    page,
    context,
  }) => {
    // Unique, so the reopened page is shown to hold this question and no other.
    const question = `Quando apre la segreteria? ${randomUUID().slice(0, 8)}`;
    await page.goto("/");
    await ask(page, question);
    await expect(page.locator("a[data-pill]")).toHaveAttribute("href", CITED);
    await expect(page).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);

    const reopened = await context.newPage();
    await reopened.goto(page.url());
    // In the thread, not only in the sidebar's list.
    await expect(reopened.getByRole("article").getByText(question)).toBeVisible();
    await expect(reopened.locator("a[data-pill]")).toHaveAttribute("href", CITED);
  });
});

test("a visitor without an account asks and is answered", async ({ page }) => {
  await page.goto("/");
  await ask(page, "Quando apre la segreteria?");
  await expect(page.locator("a[data-pill]")).toHaveAttribute("href", CITED);
});
