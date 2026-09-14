/**
 * Render a component to HTML, without a document.
 *
 * `renderToStaticMarkup` rather than `renderToString`: the latter leaves
 * React's own hydration bookkeeping in the output, and every assertion here
 * reads the markup as text. Static markup is the same tree without the noise.
 *
 * Importing `@/i18n` for its side effect is what makes `useTranslation`
 * resolve. That module initialises the default i18next instance at import time
 * (i18n/index.ts), so a provider around each tree would be a second way to do
 * what the import already did.
 *
 * The limits are the point of the file, not a caveat: no effect runs, and a
 * Radix portal has no `document.body` to aim at. A component that only shows
 * what it means after an effect — or after a click — is checked by hand, or by
 * reading its source, never by pretending this function covered it.
 */

import type { ReactElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import "@/i18n";

export function render(element: ReactElement): string {
  return renderToStaticMarkup(element);
}
