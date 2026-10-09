/**
 * axe finds nothing on any screen, in either theme (#134).
 *
 * WCAG 2.2 at level AA, by axe's tags for the A and AA criteria of 2.0, 2.1
 * and 2.2. The theme follows the system unless the reader picks one, so
 * emulating the colour scheme is how each theme is reached.
 */

import AxeBuilder from "@axe-core/playwright";

import { expect, test } from "./api";
import { arrange, SCREENS } from "./screens";

const WCAG_22_AA = ["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"];

for (const colorScheme of ["light", "dark"] as const) {
  test.describe(`${colorScheme} theme`, () => {
    test.use({ colorScheme });

    for (const screen of SCREENS) {
      test(`${screen.path} as a ${screen.as}: axe finds nothing`, async ({ page, api }) => {
        arrange(api, screen);
        await page.goto(screen.path);
        await page.waitForLoadState("networkidle");
        await expect(page.locator("html")).toHaveAttribute("data-theme", colorScheme);
        const { violations } = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
        const found = violations.map(
          ({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(" ")).join(", ")}`,
        );
        expect(found).toEqual([]);
      });
    }
  });
}
