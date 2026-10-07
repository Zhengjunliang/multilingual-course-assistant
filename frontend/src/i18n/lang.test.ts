// @vitest-environment jsdom

/**
 * The page says which language the interface is in.
 *
 * `<html lang>` used to stay at index.html's "it" whatever the reader chose,
 * so a screen reader read Chinese with an Italian voice and index.css's
 * `:lang(zh)` rules never reached the Chinese interface.
 */

import { describe, expect, it } from "vitest";

import i18n, { UI_LOCALES } from "@/i18n";

describe("the page's language", () => {
  it.each(UI_LOCALES)("follows the interface to %s", async (locale) => {
    await i18n.changeLanguage(locale);

    expect(document.documentElement.lang).toBe(locale);
    expect(document.documentElement.matches(":lang(zh)")).toBe(locale === "zh-hans");
  });
});
