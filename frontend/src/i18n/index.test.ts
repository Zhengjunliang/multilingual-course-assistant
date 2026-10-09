/**
 * Choosing an interface language shows that language, and the interface
 * starts in the right one.
 *
 * The catalogues are checked for matching keys by check-i18n.mjs; this is the
 * other half — that i18next finds a catalogue under each of Django's tags,
 * which it did not for `zh-hans` while it recased the tag to `zh-Hans`.
 */

import { describe, expect, it } from "vitest";

import i18n, { initialLocale, UI_LOCALES, type UiLocale } from "@/i18n";

describe("the interface language", () => {
  it.each(UI_LOCALES)("resolves %s to its own catalogue", async (locale) => {
    await i18n.changeLanguage(locale);

    expect(i18n.resolvedLanguage).toBe(locale);
  });
});

describe("the language the interface starts in", () => {
  it.each<{ languages: string[]; stored: string | null; starts: UiLocale }>([
    { languages: ["en-GB"], stored: null, starts: "en" },
    { languages: ["it-CH"], stored: null, starts: "it" },
    { languages: ["zh-CN"], stored: null, starts: "zh-hans" },
    { languages: ["zh"], stored: null, starts: "zh-hans" },
    { languages: ["zh-SG"], stored: null, starts: "zh-hans" },
    { languages: ["zh-Hans-HK"], stored: null, starts: "zh-hans" },
    // Traditional Chinese has no catalogue: its reader's next language wins.
    { languages: ["zh-TW", "en"], stored: null, starts: "en" },
    { languages: ["zh-Hant", "en-US"], stored: null, starts: "en" },
    { languages: ["zh-HK"], stored: null, starts: "it" },
    // The reader's order, not the catalogue's.
    { languages: ["de-DE", "en-US", "it-IT"], stored: null, starts: "en" },
    { languages: ["de-DE"], stored: null, starts: "it" },
    { languages: [], stored: null, starts: "it" },
    // A choice made on this screen comes first; a stored value that is no
    // language of the interface is not one.
    { languages: ["en-GB"], stored: "zh-hans", starts: "zh-hans" },
    { languages: ["en-GB"], stored: "fr", starts: "en" },
  ])("is $starts for $languages with $stored remembered", ({ languages, stored, starts }) => {
    expect(initialLocale(languages, stored)).toBe(starts);
  });
});
