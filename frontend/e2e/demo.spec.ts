/**
 * The demo path, on recorded answers: what the supervisor is shown, in the
 * order it is shown, run on every pull request so the demo cannot break unseen.
 */

import en from "../src/i18n/en.json" with { type: "json" };
import it from "../src/i18n/it.json" with { type: "json" };
import { expect, test } from "./api";
import {
  CAMPUS_QUESTION,
  campusStream,
  SLIDES_CITATION,
  SLIDES_QUESTION,
  STUDENT,
  slidesStream,
} from "./fixtures";

test.describe("a visitor whose browser asks for English", () => {
  test.use({ locale: "en-GB" });

  test("is greeted in English, and the page says so", async ({ page }) => {
    await page.goto("/");

    await expect(page.getByRole("heading", { name: en.empty.title })).toBeVisible();
    await expect(page.locator("html")).toHaveAttribute("lang", "en");
  });
});

test.describe("a signed-in student", () => {
  test.beforeEach(({ api }) => api.signIn(STUDENT));

  test("asks about the campus and gets an answer with its source", async ({ page, api }) => {
    api.answer(campusStream(7));
    await page.goto("/");
    await page.getByLabel(it.ask.label).fill(CAMPUS_QUESTION);
    await page.getByRole("button", { name: it.ask.submit }).click();

    await expect(page.getByText("entro cinque giorni dall'appello")).toBeVisible();
    await expect(page.getByText(it.route.unifi_web)).toBeVisible();
    await expect(page.getByRole("heading", { name: it.citations.title })).toBeVisible();
    await expect(page.locator('[data-marker="[Excerpt 1]"]')).toBeVisible();
  });

  test("asks about the slides and gets a citation naming the file and the page", async ({
    page,
    api,
  }) => {
    api.answer(slidesStream(8));
    await page.goto("/");
    await page.getByLabel(it.ask.label).fill(SLIDES_QUESTION);
    await page.getByRole("button", { name: it.ask.submit }).click();

    const card = page.locator('[data-marker="[Excerpt 1]"]');
    const pageLink = card.getByRole("link", { name: it.citations.page.replace("{{page}}", "12") });
    await expect(pageLink).toHaveAttribute(
      "href",
      `/api/sources/${SLIDES_CITATION.source_sha256}#page=12`,
    );
    // The file is in the name, not only in the hint a touch screen cannot open.
    await expect(pageLink).toHaveAccessibleName(/^pagina 12 .*basi-di-dati-05\.pdf/);
    await expect(card.getByText("B003 · 2025-2026")).toBeVisible();
  });
});

test("a visitor without an account asks about the campus and gets an answer", async ({
  page,
  api,
}) => {
  api.answer(campusStream(null));
  await page.goto("/");
  await page.getByLabel(it.ask.label).fill(CAMPUS_QUESTION);
  await page.getByRole("button", { name: it.ask.submit }).click();

  await expect(page.getByText("entro cinque giorni dall'appello")).toBeVisible();
  // A visitor's first question carries an empty history: without it the
  // server reads the request as a signed-in one whose session ended (403).
  expect(api.asked).toEqual([expect.objectContaining({ question: CAMPUS_QUESTION, history: [] })]);
});
