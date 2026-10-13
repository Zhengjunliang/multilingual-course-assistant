/**
 * axe finds nothing on any screen, in either theme (#134), nor with a source
 * card open over a pill, nor with an answer's sources open on a phone, where
 * neither the conversation nor the panel runs past its width; nor, in the shell
 * (#191), with the account menu and its languages open, with the sidebar
 * folded into its rail, or with the drawer open on a phone, where nothing
 * scrolls sideways either. Escape closes those layers one at a time, which
 * jsdom cannot show: its Radix layers stack in another order.
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
import { CONVERSATION, COURSE, PROGRAMME, STUDENT } from "./fixtures";
import { SCREENS, type Screen, visit } from "./screens";

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

/**
 * How many pixels an element's content runs past its width. Content cut by an
 * ellipsis (`truncate`) is clipped by its own box and does not count.
 */
const overrun = (element: Element) => Math.max(0, element.scrollWidth - element.clientWidth);

function screen(path: string, as: Screen["as"]): Screen {
  const found = SCREENS.find((candidate) => candidate.path === path && candidate.as === as);
  if (found === undefined) throw new Error(`${path} as a ${as} is not a screen`);
  return found;
}

/** The stored conversation, the one screen with an answer and its sources. */
const stored = () => screen(`/c/${CONVERSATION.id}`, "student");

/** A staff page's tab, by the label its count follows. */
const tab = (page: Page, label: string) => page.getByRole("tab", { name: new RegExp(`^${label}`) });

/** The account row at the sidebar's foot, named by the name and the role it shows. */
const accountRow = (page: Page) =>
  page.getByRole("button", { name: `${STUDENT.username} ${it.account.role.student}` });

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

    test("an answer's sources open on a phone: axe finds nothing, nothing runs past the width", async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await visit(page, api, stored());
      // The conversation's own column, not the document: `main` scrolls by
      // itself, so a row under an answer that ran past 375 px would widen it
      // and leave the document's width as it was.
      expect(await page.locator("main").evaluate(overrun), "the conversation").toBe(0);
      await page.getByRole("button", { name: it.sources.title }).click();
      const panel = page.getByRole("dialog", { name: it.sources.title });
      await expect(panel).toBeVisible();
      // Each row as well as the panel: the rows scroll in a box of their own,
      // which keeps what runs past it from the panel's width.
      expect(await panel.evaluate(overrun), "the sources panel").toBe(0);
      const rows = await panel.getByRole("listitem").all();
      expect(rows.length, "the panel's rows").toBeGreaterThan(0);
      for (const row of rows) {
        expect(await row.evaluate(overrun), "a source's row").toBe(0);
      }
      expect(await violations(page)).toEqual([]);
    });

    test("the account menu and its languages open: axe finds nothing", async ({ page, api }) => {
      await visit(page, api, screen("/", "student"));
      await accountRow(page).click();
      await page
        .getByRole("menuitem", { name: new RegExp(`^${it.account.language}`) })
        .press("ArrowRight");
      await expect(page.getByRole("menuitemradio")).toHaveCount(3);
      expect(await violations(page)).toEqual([]);
    });

    test("the sidebar folded into its rail: axe finds nothing", async ({ page, api }) => {
      await page.addInitScript(() => localStorage.setItem("mca.sidebar", "closed"));
      await visit(page, api, screen("/staff/programmes", "staff"));
      await expect(page.getByRole("button", { name: it.sidebar.expand })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("the drawer open on a phone: axe finds nothing, nothing scrolls sideways", async ({
      page,
      api,
    }) => {
      await page.setViewportSize({ width: 375, height: 812 });
      await visit(page, api, screen("/", "student"));
      await page.getByRole("button", { name: it.sidebar.open }).click();
      await expect(page.getByRole("dialog", { name: it.sidebar.title })).toBeVisible();
      const width = await page.evaluate(() => document.documentElement.scrollWidth);
      expect(width, "the page's width at 375 px").toBeLessThanOrEqual(375);
      expect(await violations(page)).toEqual([]);
    });

    test("a programme's and a course's second tab: axe finds nothing", async ({ page, api }) => {
      await visit(page, api, screen(`/staff/programmes/${PROGRAMME.code}`, "staff"));
      await tab(page, it.staff.secretariat.title).click();
      await expect(page.getByText(it.staff.secretariat.sub)).toBeVisible();
      expect(await violations(page)).toEqual([]);

      await visit(page, api, screen(`/staff/courses/${COURSE.code}`, "staff"));
      await tab(page, it.staff.course.inPlan).click();
      await expect(page.getByRole("heading", { name: PROGRAMME.name, exact: true })).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });

    test("the staff dialogs open: axe finds nothing", async ({ page, api }) => {
      await visit(page, api, screen("/staff/editions/11", "staff"));
      await page.getByRole("button", { name: it.staff.assign.teacher }).click();
      await expect(page.getByRole("dialog", { name: it.staff.assign.teacher })).toBeVisible();
      expect(await violations(page), "assigning").toEqual([]);
      await page.keyboard.press("Escape");

      const revoke = it.staff.revoke.actionLabel.replace("{{username}}", "Giulia Neri");
      await page.getByRole("button", { name: revoke }).click();
      await expect(page.getByRole("alertdialog", { name: it.staff.revoke.title })).toBeVisible();
      expect(await violations(page), "revoking").toEqual([]);
      await page.keyboard.press("Escape");

      await visit(page, api, screen("/staff/editions/12", "staff"));
      await page.getByRole("button", { name: it.staff.setCurrent.action }).click();
      await expect(
        page.getByRole("alertdialog", { name: it.staff.setCurrent.title }),
      ).toBeVisible();
      expect(await violations(page), "switching").toEqual([]);
    });
  });
}

test("every staff page and second tab fits 375 px without scrolling sideways", async ({
  page,
  api,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  const width = () => page.evaluate(() => document.documentElement.scrollWidth);
  for (const each of SCREENS.filter((candidate) => candidate.as === "staff")) {
    await visit(page, api, each);
    expect(await width(), each.path).toBeLessThanOrEqual(375);
  }
  await visit(page, api, screen(`/staff/programmes/${PROGRAMME.code}`, "staff"));
  await tab(page, it.staff.secretariat.title).click();
  expect(await width(), "the secretariat tab").toBeLessThanOrEqual(375);
  await visit(page, api, screen(`/staff/courses/${COURSE.code}`, "staff"));
  await tab(page, it.staff.course.inPlan).click();
  expect(await width(), "the study plans tab").toBeLessThanOrEqual(375);
});

test("/ puts the focus in the study plan's filter and types nothing into it", async ({
  page,
  api,
}) => {
  await visit(page, api, screen(`/staff/programmes/${PROGRAMME.code}`, "staff"));
  await page.keyboard.press("/");
  const filter = page.getByRole("searchbox", { name: it.staff.plan.searchLabel });
  await expect(filter).toBeFocused();
  await expect(filter).toHaveValue("");
});

test("Escape closes the language submenu, then the menu, each handing the focus back", async ({
  page,
  api,
}) => {
  await visit(page, api, screen("/", "student"));
  const row = accountRow(page);
  await row.click();
  const language = page.getByRole("menuitem", { name: new RegExp(`^${it.account.language}`) });
  await language.press("ArrowRight");
  await expect(page.getByRole("menu")).toHaveCount(2);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(1);
  await expect(language).toBeFocused();

  await page.keyboard.press("Escape");
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(row).toBeFocused();
});
