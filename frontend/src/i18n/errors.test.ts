/**
 * Every error code reads in every interface language, and a sentence asks only
 * for the values its code carries.
 *
 * A page finds `errors.<CODE>`, `errors.field.<REASON>` or
 * `errors.field.<field>.<REASON>` by the code's string (api/errors.ts), so a
 * code without a sentence would show the reader i18next's raw key, and a
 * sentence without a code is one nobody can reach: both directions are
 * checked, in each catalogue. A `{{value}}` that is not in the error's `data`
 * would reach the reader as written, braces and all; the reference under an
 * unexpected error fills in the code and the request id alone. That the three
 * catalogues agree on each sentence's placeholders is check-i18n.mjs's.
 */

import { describe, expect, it } from "vitest";

import { ERROR_CODES, FIELD_OVERRIDES, FIELD_REASONS, LOCAL_CODES } from "@/api/errors";
import i18n, { UI_LOCALES } from "@/i18n";

import en from "./en.json";
import italian from "./it.json";
import zhHans from "./zh-hans.json";

const CATALOGUES = { it: italian, en, "zh-hans": zhHans };

/** Each code a page reads a sentence for, with the values its error carries. */
const CODE_DATA: Record<string, readonly string[]> = {
  ...Object.fromEntries(
    Object.entries(ERROR_CODES).map(([code, { dataKeys }]) => [code, dataKeys]),
  ),
  ...Object.fromEntries(LOCAL_CODES.map((code) => [code, []])),
};

const REASON_DATA: Record<string, readonly string[]> = Object.fromEntries(
  Object.entries(FIELD_REASONS).map(([reason, { dataKeys }]) => [reason, dataKeys]),
);

function placeholders(sentence: string): string[] {
  return [...sentence.matchAll(/\{\{\s*(\w+)/g)].map((match) => match[1] ?? "");
}

/** `key: placeholder` for each placeholder of `sentence` that `carried` lacks. */
function strays(key: string, sentence: string, carried: readonly string[] = []): string[] {
  return placeholders(sentence)
    .filter((name) => !carried.includes(name))
    .map((name) => `${key}: ${name}`);
}

describe.each(UI_LOCALES)("the %s error sentences", (locale) => {
  const { field, reference, legacy, ...codes } = CATALOGUES[locale].errors;
  const fieldEntries = Object.entries<string | Record<string, string>>(field);
  const reasons = fieldEntries.filter(
    (entry): entry is [string, string] => typeof entry[1] === "string",
  );
  const overrides = fieldEntries.filter(
    (entry): entry is [string, Record<string, string>] => typeof entry[1] === "object",
  );

  it("name exactly the codes the server and the client give", () => {
    expect(new Set(Object.keys(codes))).toEqual(new Set(Object.keys(CODE_DATA)));
  });

  it("name exactly the field reasons, and the overrides api/errors.ts lists", () => {
    expect(new Set(reasons.map(([reason]) => reason))).toEqual(new Set(Object.keys(REASON_DATA)));
    expect(
      Object.fromEntries(
        overrides.map(([name, sentences]) => [name, new Set(Object.keys(sentences))]),
      ),
    ).toEqual(
      Object.fromEntries(
        Object.entries(FIELD_OVERRIDES).map(([name, list]) => [name, new Set(list)]),
      ),
    );
  });

  // A sentence may be another's, `$t(errors.INTERNAL)`; a misspelt one would
  // show its key.
  it("resolve the sentences they borrow", async () => {
    await i18n.changeLanguage(locale);

    const shown = Object.keys(codes).map((code) => i18n.t(`errors.${code}`));

    expect(shown.filter((sentence) => sentence.includes("errors."))).toEqual([]);
  });

  it("ask only for values the error carries", () => {
    expect([
      ...Object.entries(codes).flatMap(([code, sentence]) =>
        strays(code, sentence, CODE_DATA[code]),
      ),
      ...reasons.flatMap(([reason, sentence]) => strays(reason, sentence, REASON_DATA[reason])),
      ...Object.entries(reference).flatMap(([name, sentence]) =>
        strays(`reference.${name}`, sentence, ["code", "id"]),
      ),
      ...strays("legacy", legacy, ["text"]),
      ...overrides.flatMap(([name, sentences]) =>
        Object.entries(sentences).flatMap(([reason, sentence]) =>
          strays(`${name}.${reason}`, sentence, REASON_DATA[reason]),
        ),
      ),
    ]).toEqual([]);
  });
});
