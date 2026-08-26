import i18n from "i18next";
import { initReactI18next } from "react-i18next";

import en from "./en.json";
import it from "./it.json";
import zhHans from "./zh-hans.json";

/**
 * The three interface languages, named the way Django names them.
 *
 * `settings.LANGUAGES` is the source (it/en/zh-hans), and the account's
 * `User.locale` is what selects one — the model docstring says that field
 * drives the interface. Until the login stage exists there is no account, so
 * this starts on the project default and the switch arrives with the session.
 *
 * Note the namespace: these are Django language tags. The answer language the
 * pipeline speaks is a BCP-47 primary subtag (`zh`, not `zh-hans`), and
 * `rag.chunk.normalize_locale` is the one bridge between them. Nothing here may
 * invent the reverse mapping.
 */
export const UI_LOCALES = ["it", "en", "zh-hans"] as const;
export type UiLocale = (typeof UI_LOCALES)[number];

export const DEFAULT_UI_LOCALE: UiLocale = "it";

void i18n.use(initReactI18next).init({
  resources: {
    it: { translation: it },
    en: { translation: en },
    "zh-hans": { translation: zhHans },
  },
  lng: DEFAULT_UI_LOCALE,
  fallbackLng: DEFAULT_UI_LOCALE,
  // React escapes for us; doing it twice mangles apostrophes in Italian.
  interpolation: { escapeValue: false },
});

export default i18n;
