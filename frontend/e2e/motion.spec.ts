/**
 * Nothing moves when the system asks for reduced motion (#134).
 *
 * "Moves" is a keyframe animation, or a transition of an element's position,
 * size or turn. A colour or an opacity may still change, the way Apple's Human
 * Interface Guidelines suggest a dissolve in place of motion: what WCAG 2.3.3
 * guards against is motion, and a fading hover moves nothing.
 *
 * Every screen is read at rest, and the chat twice more mid-answer, because
 * that is when the interface animates: the mascot's thinking pose before the
 * first word, the cursor while words arrive.
 */

import type { Page } from "@playwright/test";

import it from "../src/i18n/it.json" with { type: "json" };
import { expect, test } from "./api";
import { CAMPUS_QUESTION, campusStream, STUDENT } from "./fixtures";
import { arrange, SCREENS } from "./screens";

const MOVING_PROPERTIES = [
  "transform",
  "translate",
  "scale",
  "rotate",
  "inset",
  "top",
  "right",
  "bottom",
  "left",
];

test.use({ reducedMotion: "reduce" });

/** What is moving on the page now, named well enough to find it. */
function moving(page: Page): Promise<string[]> {
  return page.evaluate((properties) => {
    const where = (animation: Animation) => {
      const target = (animation.effect as KeyframeEffect | null)?.target;
      return target ? `${target.tagName.toLowerCase()}.${[...target.classList].join(".")}` : "?";
    };
    return document
      .getAnimations()
      .filter((animation) => animation.playState === "running")
      .flatMap((animation) => {
        if (animation instanceof CSSTransition) {
          return properties.includes(animation.transitionProperty)
            ? [`transition of ${animation.transitionProperty} on ${where(animation)}`]
            : [];
        }
        if (animation instanceof CSSAnimation) {
          return [`animation ${animation.animationName} on ${where(animation)}`];
        }
        return [`a scripted animation on ${where(animation)}`];
      });
  }, MOVING_PROPERTIES);
}

for (const screen of SCREENS) {
  test(`${screen.path} as a ${screen.as}: nothing moves at rest`, async ({ page, api }) => {
    arrange(api, screen);
    await page.goto(screen.path);
    await page.waitForLoadState("networkidle");
    expect(await moving(page)).toEqual([]);
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
    expect(await moving(page)).toEqual([]);
  });

  test("while the words arrive: nothing moves", async ({ page, api }) => {
    api.holdAnswer(campusStream(7).slice(0, 2));
    await ask(page);
    await expect(page.getByText(it.status.streaming)).toBeAttached();
    expect(await moving(page)).toEqual([]);
  });
});
