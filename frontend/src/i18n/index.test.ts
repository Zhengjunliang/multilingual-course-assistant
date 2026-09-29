/**
 * Choosing an interface language shows that language.
 *
 * The catalogues are checked for matching keys by check-i18n.mjs; this is the
 * other half — that i18next finds a catalogue under each of Django's tags,
 * which it did not for `zh-hans` while it recased the tag to `zh-Hans`.
 */

import { describe, expect, it } from "vitest";

import i18n, { UI_LOCALES } from "@/i18n";

describe("the interface language", () => {
  it.each(UI_LOCALES)("resolves %s to its own catalogue", async (locale) => {
    await i18n.changeLanguage(locale);

    expect(i18n.resolvedLanguage).toBe(locale);
  });
});
