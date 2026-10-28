/**
 * Nothing moves when the system asks for reduced motion (#134), and without
 * that request the first question's box travels to the foot of the page in one
 * smooth slide.
 *
 * "Moves" is a keyframe animation, or a transition of an element's position,
 * size or turn. A colour or an opacity may still change, the way Apple's Human
 * Interface Guidelines suggest a dissolve in place of motion: what WCAG 2.3.3
 * guards against is motion, and a fading hover moves nothing.
 *
 * Every animation and transition is recorded as it starts, from the page's
 * first frame, so one that has already finished is caught as surely as one
 * that loops; a reading of what runs at a single moment would miss the first
 * kind. Every screen is checked at rest, and the chat twice more mid-answer,
 * when the interface animates: the process line's shimmer while the search
 * runs, the mascot's thinking pose and the lone caret before the first word,
 * the caret while words arrive.
 */

import type { Page } from "@playwright/test";

import { uuidOf } from "@/test/conversations";
import it from "../src/i18n/it.json" with { type: "json" };
import { expect, test } from "./api";
import { CAMPUS_QUESTION, campusStream, STUDENT } from "./fixtures";
import { SCREENS, visit } from "./screens";

const MOVING_PROPERTIES = [
  "transform",
  "translate",
  "scale",
  "rotate",
  "top",
  "right",
  "bottom",
  "left",
  "width",
  "height",
  "min-width",
  "min-height",
  "max-width",
  "max-height",
  "block-size",
  "inline-size",
];

test.use({ reducedMotion: "reduce" });

test.beforeEach(async ({ page }) => {
  await page.addInitScript((properties) => {
    const moved: string[] = [];
    Object.assign(window, { __moved: moved });
    const where = (target: EventTarget | null) =>
      target instanceof Element
        ? `${target.tagName.toLowerCase()}.${[...target.classList].join(".")}`
        : "?";
    document.addEventListener(
      "animationstart",
      (event) => moved.push(`animation ${event.animationName} on ${where(event.target)}`),
      true,
    );
    document.addEventListener(
      "transitionrun",
      (event) => {
        if (properties.includes(event.propertyName)) {
          moved.push(`transition of ${event.propertyName} on ${where(event.target)}`);
        }
      },
      true,
    );
  }, MOVING_PROPERTIES);
});

/**
 * Everything that has moved since the page opened, named well enough to find it.
 *
 * The record alone is not enough: its events are sent with the frame after an
 * animation starts, so one that began a moment ago is not in it yet. What the
 * document is animating now covers that moment, and what a script animates
 * through the Web Animations API, which sends no events at all.
 */
function moved(page: Page): Promise<string[]> {
  return page.evaluate((properties) => {
    const recorded = (window as unknown as { __moved: string[] }).__moved;
    const where = (target: Element | null | undefined) =>
      target ? `${target.tagName.toLowerCase()}.${[...target.classList].join(".")}` : "?";
    const now = document.getAnimations().flatMap((animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      if (animation instanceof CSSTransition) {
        return properties.includes(animation.transitionProperty)
          ? [`transition of ${animation.transitionProperty} on ${where(target)}`]
          : [];
      }
      if (animation instanceof CSSAnimation) {
        return [`animation ${animation.animationName} on ${where(target)}`];
      }
      return [`a scripted animation on ${where(target)}`];
    });
    return [...new Set([...recorded, ...now])];
  }, MOVING_PROPERTIES);
}

/**
 * The living cat's drawing, every attribute of it, once per cat on the page.
 *
 * It moves on `requestAnimationFrame` (components/LivingMascot.tsx), which
 * neither the events above nor `document.getAnimations()` can see, so the
 * drawing itself is read twice and compared. A quarter of a second is fifteen
 * frames, and a living cat's tail moves on every one of them.
 */
function catDrawings(page: Page): Promise<string[]> {
  return page
    .locator("[data-living-mascot]")
    .evaluateAll((cats) => cats.map((cat) => cat.innerHTML));
}

for (const screen of SCREENS) {
  test(`${screen.path} as a ${screen.as}: nothing moves at rest`, async ({ page, api }) => {
    await visit(page, api, screen);
    expect(await moved(page)).toEqual([]);
    const cats = await catDrawings(page);
    if (cats.length > 0) await page.waitForTimeout(250);
    expect(await catDrawings(page), "the living cat's drawing").toEqual(cats);
  });
}

test("a visitor's first visit: the intro does not play", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("heading", { name: it.entry.caption, exact: true })).toBeVisible();
  const cats = await catDrawings(page);
  await page.waitForTimeout(250);

  expect({
    skip: await page.getByRole("button", { name: it.entry.skip }).count(),
    caption: await page.getByRole("heading", { name: it.entry.caption }).textContent(),
    moved: await moved(page),
    still: (await catDrawings(page)).join() === cats.join(),
  }).toEqual({ skip: 0, caption: it.entry.caption, moved: [], still: true });
});

test.describe("the chat mid-answer", () => {
  test.beforeEach(({ api }) => api.signIn(STUDENT));

  async function ask(page: Page) {
    await page.goto("/");
    await page.getByLabel(it.ask.label).fill(CAMPUS_QUESTION);
    await page.getByRole("button", { name: it.ask.submit }).click();
  }

  test("while the search runs: nothing moves", async ({ page, api }) => {
    api.holdAnswer([]);
    await ask(page);
    await expect(page.locator(".shimmer")).toBeVisible();
    expect(await moved(page)).toEqual([]);
  });

  test("before the first word: nothing moves", async ({ page, api }) => {
    api.holdAnswer(campusStream(uuidOf(7)).slice(0, 1));
    await ask(page);
    // The fixture's search took 2400 ms, which the line shows as 3 s.
    await expect(page.getByText(it.process.done.replace("{{seconds}}", "3"))).toBeVisible();
    expect(await moved(page)).toEqual([]);
  });

  test("while the words arrive: nothing moves", async ({ page, api }) => {
    api.holdAnswer(campusStream(uuidOf(7)).slice(0, 2));
    await ask(page);
    // The answer's own words for a screen reader; the composer's foot says it too.
    await expect(page.getByRole("article").getByText(it.status.streaming)).toBeAttached();
    expect(await moved(page)).toEqual([]);
  });
});

/**
 * The question box on one frame: its top, its width, whether it wears the
 * travel, whether its field has the focus, and whether anything is typed in it.
 */
type Frame = { top: number; width: number; travel: boolean; focused: boolean; typed: boolean };

test.describe("the first question, sent from the entry", () => {
  // The one motion that has to play: it is what the system has not asked to be spared.
  test.use({ reducedMotion: "no-preference" });
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
      api.answer(campusStream(uuidOf(7)));
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
