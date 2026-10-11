/**
 * axe finds nothing on any screen, in either theme (#134), nor with a hint
 * open over one.
 *
 * WCAG 2.2 at level AA, by axe's tags for the A and AA criteria of 2.0, 2.1
 * and 2.2. The theme follows the system unless the reader picks one, so
 * emulating the colour scheme is how each theme is reached. A hint is drawn
 * only while open, so a screen at rest never shows axe one: the stored
 * conversation's citation badge is focused to open it.
 */

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import { expect, test } from "./api";
import { CONVERSATION } from "./fixtures";
import { SCREENS, visit } from "./screens";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

/**
 * What axe finds on the page as it stands, one line per rule: every violation,
 * and every contrast it could not measure. axe leaves a contrast unmeasured,
 * as `incomplete` rather than as a violation, wherever text sits over a
 * background image or a gradient (axe-core's `bgImage` and `bgGradient`), so a
 * check that read violations alone would pass a screen whose contrast it never
 * saw.
 */
async function violations(page: Page): Promise<string[]> {
  const { violations, incomplete } = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  const found = violations.map(
    ({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(" ")).join(", ")}`,
  );
  // axe says why it could not measure, as a message key on the node's check.
  const unmeasured = incomplete
    .filter(({ id }) => id === "color-contrast")
    .flatMap(({ nodes }) => nodes)
    .map(({ target, any }) => {
      const reason = (any[0]?.data as { messageKey?: string } | null)?.messageKey ?? "no reason";
      return `color-contrast unmeasured (${reason}): ${target.join(" ")}`;
    });
  return [...found, ...unmeasured];
}

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const screen of SCREENS) {
      test(`${screen.path} as a ${screen.as}: axe finds nothing`, async ({ page, api }) => {
        await visit(page, api, screen);
        await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
        expect(await violations(page)).toEqual([]);
      });
    }

    test("a hint open over a citation badge: axe finds nothing", async ({ page, api }) => {
      const stored = SCREENS.find(({ path }) => path === `/c/${CONVERSATION.id}`);
      if (stored === undefined) throw new Error("the stored conversation is not a screen");
      await visit(page, api, stored);
      await page.getByRole("button", { name: /\[Excerpt 1\]$/ }).focus();
      await expect(page.getByRole("tooltip")).toHaveText("[Excerpt 1]");
      expect(await violations(page)).toEqual([]);
    });
  });
}
