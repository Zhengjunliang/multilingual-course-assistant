/**
 * axe finds nothing on any screen, in either theme (#134), nor with a source
 * card open over a pill, nor with an answer's sources open.
 *
 * WCAG 2.2 at level AA, by axe's tags for the A and AA criteria of 2.0, 2.1
 * and 2.2. The theme follows the system unless the reader picks one, so
 * emulating the colour scheme is how each theme is reached. A card and a
 * panel are drawn only while open, so a screen at rest never shows axe one:
 * the stored conversation's pill is focused to open the first, and its sources
 * button pressed for the second.
 */

import AxeBuilder from "@axe-core/playwright";
import type { Page } from "@playwright/test";

import it from "../src/i18n/it.json" with { type: "json" };
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
 *
 * The grain over the ground (index.css) is such an image, on every screen, so
 * it is taken away first and the contrast is measured on the bare ground;
 * what the grain's strongest pixel leaves of that contrast is measured once,
 * in index.css's note on it.
 *
 * Text that wraps on a layer floating over the page, a hover card or a dialog,
 * is left unmeasured too, as `elmPartiallyObscuring`: axe compares what lies
 * under each line of the text, and under a floating layer that is different
 * page content line by line, whatever the layer's own colours. That text is
 * measured here instead (`floatingContrast`), and only a ratio under 4.5:1
 * is reported.
 */
async function violations(page: Page): Promise<string[]> {
  await page.addStyleTag({ content: ":root, [data-theme] { --grain: none !important; }" });
  const { violations, incomplete } = await new AxeBuilder({ page }).withTags(WCAG_22_AA).analyze();
  const found = violations.map(
    ({ id, nodes }) => `${id}: ${nodes.map(({ target }) => target.join(" ")).join(", ")}`,
  );
  // axe says why it could not measure, as a message key on the node's check.
  const unmeasured: string[] = [];
  for (const { target, any } of incomplete
    .filter(({ id }) => id === "color-contrast")
    .flatMap(({ nodes }) => nodes)) {
    const reason = (any[0]?.data as { messageKey?: string } | null)?.messageKey ?? "no reason";
    const selector = target.join(" ");
    if (reason === "elmPartiallyObscuring") {
      const ratios = await floatingContrast(page, selector);
      if (ratios.length > 0 && ratios.every((ratio) => ratio >= 4.5)) continue;
      if (ratios.length > 0) {
        unmeasured.push(`color-contrast ${Math.min(...ratios).toFixed(2)}:1: ${selector}`);
        continue;
      }
    }
    unmeasured.push(`color-contrast unmeasured (${reason}): ${selector}`);
  }
  return [...found, ...unmeasured];
}

/**
 * The contrast of the text `selector` names on a floating layer, as WCAG
 * defines it: its colour against the nearest opaque background under it in
 * the layer. The browser draws both colours to a canvas, which reads any CSS
 * colour, `oklch()` included, back as sRGB. Text outside a floating layer is
 * not measured here; axe's word stands for it.
 */
function floatingContrast(page: Page, selector: string): Promise<number[]> {
  return page.evaluate((wanted) => {
    const canvas = document.createElement("canvas");
    canvas.width = 1;
    canvas.height = 1;
    const pen = canvas.getContext("2d", { willReadFrequently: true });
    const rgba = (css: string) => {
      if (pen === null) return [0, 0, 0, 0];
      pen.clearRect(0, 0, 1, 1);
      pen.fillStyle = css;
      pen.fillRect(0, 0, 1, 1);
      return [...pen.getImageData(0, 0, 1, 1).data];
    };
    const luminance = (rgb: number[]) => {
      const [r, g, b] = rgb.map((value) => {
        const channel = value / 255;
        return channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
      });
      return 0.2126 * (r ?? 0) + 0.7152 * (g ?? 0) + 0.0722 * (b ?? 0);
    };
    return [...document.querySelectorAll(wanted)]
      .filter((element) => element.closest('[data-radix-popper-content-wrapper], [role="dialog"]'))
      .map((element) => {
        let layer: Element | null = element;
        while (layer !== null && rgba(getComputedStyle(layer).backgroundColor)[3] !== 255) {
          layer = layer.parentElement;
        }
        if (layer === null) return 0;
        const text = luminance(rgba(getComputedStyle(element).color));
        const ground = luminance(rgba(getComputedStyle(layer).backgroundColor));
        return (Math.max(text, ground) + 0.05) / (Math.min(text, ground) + 0.05);
      });
  }, selector);
}

/** The stored conversation, the one screen with an answer and its sources. */
function stored() {
  const screen = SCREENS.find(({ path }) => path === `/c/${CONVERSATION.id}`);
  if (screen === undefined) throw new Error("the stored conversation is not a screen");
  return screen;
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

    test("a source card open over a pill: axe finds nothing", async ({ page, api }) => {
      await visit(page, api, stored());
      await page.locator("a[data-pill]").focus();
      await expect(page.locator("[data-radix-popper-content-wrapper]")).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("an answer's sources open: axe finds nothing", async ({ page, api }) => {
      await visit(page, api, stored());
      await page.getByRole("button", { name: it.sources.title }).click();
      await expect(page.getByRole("dialog", { name: it.sources.title })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}
