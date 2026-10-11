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

    await expect(page.getByRole("heading", { name: en.entry.caption })).toBeVisible();
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

/**
 * The question box on one frame: its top, its width, whether it wears the
 * travel, whether its field has the focus, and whether anything is typed in it.
 */
type Frame = { top: number; width: number; travel: boolean; focused: boolean; typed: boolean };

test.describe("the first question, sent from the entry", () => {
  test.beforeEach(({ api }) => api.signIn(STUDENT));

  for (const viewport of [
    { width: 1440, height: 900 },
    { width: 375, height: 812 },
  ]) {
    test(`at ${viewport.width} px the question box travels to the foot and keeps what is typed on the way`, async ({
      page,
      api,
    }) => {
      // Every frame from the moment Enter goes down to the first one after the
      // box has landed, however long a busy machine takes to get there.
      await page.addInitScript(() => {
        const frames: Frame[] = [];
        Object.assign(window, { __frames: frames, __sampled: false });
        let started = false;
        let landed = false;
        document.addEventListener("animationend", (event) => {
          if (event.animationName === "travel") landed = true;
        });
        document.addEventListener(
          "keydown",
          (event) => {
            if (event.key !== "Enter" || started) return;
            started = true;
            const sample = () => {
              const field = document.getElementById("question");
              const box = field?.closest(".bg-pill");
              if (field instanceof HTMLTextAreaElement && box) {
                const { top, width } = box.getBoundingClientRect();
                frames.push({
                  top,
                  width,
                  travel: getComputedStyle(box).animationName === "travel",
                  focused: document.activeElement === field,
                  typed: field.value !== "",
                });
              }
              if (landed) Object.assign(window, { __sampled: true });
              else requestAnimationFrame(sample);
            };
            requestAnimationFrame(sample);
          },
          true,
        );
      });
      await page.setViewportSize(viewport);
      api.answer(campusStream(7));
      await page.goto("/");
      const field = page.getByLabel(it.ask.label);
      await field.fill(CAMPUS_QUESTION);
      await field.press("Enter");
      // Typed at once, while the cat hops and the entry recedes, so the
      // switch to the conversation and the travel both come after it.
      await page.keyboard.type("e poi");
      await page.waitForFunction(() => (window as unknown as { __sampled: boolean }).__sampled);

      const frames = await page.evaluate(
        () => (window as unknown as { __frames: Frame[] }).__frames,
      );
      const tops = frames.map((frame) => frame.top);
      const from = tops[0] ?? 0;
      const to = tops.at(-1) ?? 0;
      const steps = tops.slice(1).map((top, n) => top - (tops[n] ?? top));
      expect(to, "the box ends lower than it began").toBeGreaterThan(from);
      expect(
        tops.filter((top) => top > from + 0.5 && top < to - 0.5).length,
        "frames with the box between its two places",
      ).toBeGreaterThanOrEqual(6);
      // A box that jumped part of the way and slid the rest would pass the
      // count above; the travel starts where the box stood. Read on the first
      // frame that wears it, when it has not run yet, so a slow frame on a
      // busy machine cannot make the start look like a jump.
      expect(
        Math.abs((frames.find((frame) => frame.travel)?.top ?? to) - from),
        "where the travel starts, from where the box stood",
      ).toBeLessThanOrEqual(1);
      expect({
        upward: steps.filter((step) => step < -0.5).length,
        widths: [...new Set(frames.map((frame) => Math.round(frame.width)))].length,
        unfocused: frames.filter((frame) => !frame.focused).length,
        typedBeforeLanding: frames.slice(0, -1).some((frame) => frame.typed),
      }).toEqual({ upward: 0, widths: 1, unfocused: 0, typedBeforeLanding: true });
      await expect(field).toHaveValue("e poi");
      await expect(field).toBeFocused();
    });
  }
});
