/**
 * Chinese takes its punctuation from a Chinese face, and no other language
 * does: what a browser computes from the language rules of src/index.css,
 * which src/index.css.test.ts reads as text. A heading is set in the face of
 * everything else, Figtree.
 *
 * Each element's first family is compared whole, since "Figtree Latin" also
 * starts with "Figtree". The elements are added to the page as a reader's text
 * would be: one with no class and no `lang`, which inherits the interface's
 * language, and one whose `lang` names another.
 */

import type { Page } from "@playwright/test";

import it from "../src/i18n/it.json" with { type: "json" };
import zh from "../src/i18n/zh-hans.json" with { type: "json" };
import { expect, test } from "./api";

/** The first family the body, a plain paragraph and one in `lang` are set in. */
function firstFamilies(page: Page, lang: string) {
  return page.evaluate((other) => {
    const first = (element: Element) =>
      getComputedStyle(element).fontFamily.split(",")[0]?.trim().replace(/^"|"$/g, "");
    const plain = document.createElement("p");
    const foreign = document.createElement("p");
    foreign.lang = other;
    document.body.append(plain, foreign);
    return { body: first(document.body), plain: first(plain), foreign: first(foreign) };
  }, lang);
}

test.describe("the Chinese interface", () => {
  test.use({ locale: "zh-CN" });

  test("sets its text in the Chinese stack, and an Italian excerpt in the Latin one", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: zh.entry.caption })).toBeVisible();

    expect(await firstFamilies(page, "it")).toEqual({
      body: "Figtree Latin",
      plain: "Figtree Latin",
      foreign: "Figtree",
    });
  });
});

test.describe("a heading", () => {
  test.use({ viewport: { width: 1440, height: 900 } });

  test("is set in Figtree, the face of everything else", async ({ page }) => {
    await page.goto("/login");
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();

    expect(
      await heading.evaluate(
        (element) =>
          getComputedStyle(element).fontFamily.split(",")[0]?.trim().replace(/^"|"$/g, "") ?? "",
      ),
    ).toBe("Figtree");
  });
});

test.describe("the Italian interface", () => {
  test("sets its text in the Latin stack, and a Chinese excerpt in the Chinese one", async ({
    page,
  }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: it.entry.caption })).toBeVisible();

    expect(await firstFamilies(page, "zh-hans")).toEqual({
      body: "Figtree",
      plain: "Figtree",
      foreign: "Figtree Latin",
    });
  });
});
