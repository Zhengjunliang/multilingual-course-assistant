/**
 * Nothing moves when the system asks for reduced motion (#134).
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
 * when the interface animates: the mascot's thinking pose before the first
 * word, the cursor while words arrive.
 */

import type { Page } from "@playwright/test";

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

for (const screen of SCREENS) {
  test(`${screen.path} as a ${screen.as}: nothing moves at rest`, async ({ page, api }) => {
    await visit(page, api, screen);
    expect(await moved(page)).toEqual([]);
  });
}

test.describe("the chat mid-answer", () => {
  test.beforeEach(({ api }) => api.signIn(STUDENT));

  async function ask(page: Page) {
    await page.goto("/");
    await page.getByLabel(it.ask.label).fill(CAMPUS_QUESTION);
    await page.getByRole("button", { name: it.ask.submit }).click();
  }

  test("before the first word: nothing moves", async ({ page, api }) => {
    api.holdAnswer(campusStream(7).slice(0, 1));
    await ask(page);
    await expect(page.getByText(it.status.thinking)).toBeVisible();
    expect(await moved(page)).toEqual([]);
  });

  test("while the words arrive: nothing moves", async ({ page, api }) => {
    api.holdAnswer(campusStream(7).slice(0, 2));
    await ask(page);
    await expect(page.getByText(it.status.streaming)).toBeAttached();
    expect(await moved(page)).toEqual([]);
  });
});
