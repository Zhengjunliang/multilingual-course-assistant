// @vitest-environment jsdom

/**
 * The settings: the theme alone.
 *
 * `ThemeProvider` is the real one rather than a fake context, because the
 * assertion worth making is that clicking "dark" *changes the theme* — which
 * `ThemeProvider` records by writing `data-theme` on the document element — and
 * not merely that a spy was called. That works here only because
 * `test/setup.ts` stands in for `matchMedia`, which jsdom does not have.
 */

import { act } from "react";
import { describe, expect, it } from "vitest";

import { CANVAS, CANVAS_DARK } from "@/brand/fumetto";
import { SettingsDialog } from "@/components/SettingsDialog";
import { mount } from "@/test/mount";
import { ThemeProvider } from "@/theme/ThemeProvider";

function dialog() {
  return mount(
    <ThemeProvider>
      <SettingsDialog open onOpenChange={() => {}} />
    </ThemeProvider>,
  );
}

function buttonLabelled(text: string) {
  return [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
}

describe("the settings dialog", () => {
  it("offers all three themes and holds nothing else", () => {
    const { unmount } = dialog();
    const offered = ["Di sistema", "Chiaro", "Scuro"].map((label) => buttonLabelled(label));
    const menus = document.body.querySelectorAll('[aria-haspopup="menu"]').length;
    unmount();

    for (const button of offered) expect(button).toBeDefined();
    // The language is the account menu's.
    expect(menus).toBe(0);
    expect(buttonLabelled("Esci")).toBeUndefined();
  });

  it("actually changes the theme when one is chosen", () => {
    const { unmount } = dialog();

    act(() => buttonLabelled("Scuro")?.click());
    expect(document.documentElement.dataset.theme).toBe("dark");

    act(() => buttonLabelled("Chiaro")?.click());
    expect(document.documentElement.dataset.theme).toBe("light");

    unmount();
  });

  it("gives the browser's bar the chosen theme, whatever the system says", () => {
    // index.html carries one theme-color per system scheme; a reader's own
    // choice has to win over both, or a dark page sits under a light bar.
    for (const scheme of ["light", "dark"]) {
      const meta = document.createElement("meta");
      meta.name = "theme-color";
      meta.media = `(prefers-color-scheme: ${scheme})`;
      document.head.append(meta);
    }
    const bar = () =>
      [...document.querySelectorAll('meta[name="theme-color"]')].map((meta) =>
        meta.getAttribute("content"),
      );
    const { unmount } = dialog();

    act(() => buttonLabelled("Scuro")?.click());
    const dark = bar();
    act(() => buttonLabelled("Chiaro")?.click());
    const light = bar();
    unmount();
    for (const meta of document.querySelectorAll('meta[name="theme-color"]')) meta.remove();

    expect(dark).toEqual([CANVAS_DARK, CANVAS_DARK]);
    expect(light).toEqual([CANVAS, CANVAS]);
  });
});
