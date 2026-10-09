import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./en.json";
import it from "./it.json";
import zhHans from "./zh-hans.json";

/**
 * The three interface languages, named the way Django names them.
 *
 * `settings.LANGUAGES` is the source (it/en/zh-hans), and the account's
 * `User.locale` is what selects one once a reader is signed in — the model
 * docstring says that field drives the interface. Before that, the interface
 * starts in the language the reader chose on this screen, or else in the
 * browser's (`initialLocale`).
 *
 * Note the namespace: these are Django language tags. The answer language the
 * pipeline speaks is a BCP-47 primary subtag (`zh`, not `zh-hans`), and
 * `rag.chunk.normalize_locale` is the one bridge between them. Nothing here may
 * invent the reverse mapping.
 */
export const UI_LOCALES = ["it", "en", "zh-hans"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const DEFAULT_UI_LOCALE: UiLocale = "it";

export function isUiLocale(value: string | null): value is UiLocale {
  return (UI_LOCALES as readonly (string | null)[]).includes(value);
}

/**
 * The interface language a browser language tag asks for, or `null` when it
 * asks for none of them.
 *
 * Chinese counts as Simplified when the tag says nothing else, names the
 * script, or names mainland China or Singapore. Taiwan, Hong Kong and Macau
 * write Traditional characters, which no catalogue here has, so those readers
 * fall through to their next language rather than to a script that is not
 * theirs.
 */
function uiLocaleOf(tag: string): UiLocale | null {
  const [language, ...subtags] = tag.toLowerCase().split("-");
  if (language === "it" || language === "en") return language;
  if (language !== "zh") return null;
  if (subtags.includes("hans")) return "zh-hans";
  if (subtags.includes("hant")) return null;
  const simplified = subtags.length === 0 || subtags.includes("cn") || subtags.includes("sg");
  return simplified ? "zh-hans" : null;
}

/**
 * The language the interface starts in: the one the reader chose on this
 * screen, if they ever did; else the first of the browser's languages, in
 * the reader's order, that the interface speaks; else Italian.
 *
 * The browser's languages are where to start and no more (W3C, "Accept-Language
 * used for locale setting"): the reader can change it from every screen, and
 * a choice is remembered. Moodle starts the same way.
 */
export function initialLocale(languages: readonly string[], stored: string | null): UiLocale {
  if (isUiLocale(stored)) return stored;
  for (const tag of languages) {
    const locale = uiLocaleOf(tag);
    if (locale !== null) return locale;
  }
  return DEFAULT_UI_LOCALE;
}

const STORAGE_KEY = "mca.locale";

/**
 * The language chosen on this screen, from the last time anyone chose one.
 * `localStorage` throws in a private window or with site data blocked, and
 * does not exist outside a browser; a reader who cannot be remembered still
 * gets a working page.
 */
function storedLocale(): string | null {
  try {
    return globalThis.localStorage?.getItem(STORAGE_KEY) ?? null;
  } catch {
    return null;
  }
}

/**
 * Switches the interface to `locale` and remembers it on this screen.
 *
 * Only for a choice: the reader's own, from a language menu, or their
 * account's, once they sign in. The language the interface merely started in
 * is never written, or the browser's language would be frozen into a choice
 * nobody made; that is why this is not a `languageChanged` listener, which
 * `init` itself would fire. Signing out leaves it, so the screen keeps the
 * language its last reader used.
 */
export function chooseUiLocale(locale: UiLocale): Promise<unknown> {
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, locale);
  } catch {
    // Not remembered; the page still switches.
  }
  return i18n.changeLanguage(locale);
}

// The page says which language it is in, because two things read it: a screen
// reader picks its voice from it (WCAG 3.1.1), and index.css sets Chinese by
// `:lang(zh)`. Registered before `init`, which announces the first language.
i18n.on("languageChanged", (language) => {
  if (typeof document !== "undefined") document.documentElement.lang = language;
});

void i18n.use(initReactI18next).init({
  resources: {
    it: { translation: it },
    en: { translation: en },
    "zh-hans": { translation: zhHans },
  },
  lng: initialLocale(globalThis.navigator?.languages ?? [], storedLocale()),
  fallbackLng: DEFAULT_UI_LOCALE,
  // Django's tags are lower case. Left to itself i18next rewrites `zh-hans` to
  // the BCP-47 casing `zh-Hans` while resolving it, finds no resources under
  // that key, and falls back to Italian.
  lowerCaseLng: true,
  // React escapes for us; doing it twice mangles apostrophes in Italian.
  interpolation: { escapeValue: false },
});

export default i18n;
