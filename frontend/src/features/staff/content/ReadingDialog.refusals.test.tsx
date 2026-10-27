// @vitest-environment jsdom

/**
 * A book refused at one of its fields reads in the interface's language,
 * whatever the browser and the server speak (#186): the dialog finds the
 * field's sentence by its reason, so the server's message — here the sentence
 * of the browser's language — never reaches the reader, and a change of
 * language rewords a refusal already under its field.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/api/account";
import type { ErrorData, FieldViolation } from "@/api/errors";
import { SessionContext } from "@/auth/SessionProvider";
import i18n, { UI_LOCALES, type UiLocale } from "@/i18n";
import { mount } from "@/test/mount";
import { ReadingDialog } from "./ReadingDialog";

/** The browser's language, which the server's message follows: never the page's. */
const BROWSER: Record<UiLocale, UiLocale> = { it: "en", en: "zh-hans", "zh-hans": "it" };

const READER: Account = {
  id: 1,
  username: "demo-teacher",
  locale: "it",
  is_superuser: false,
  roles: [{ role: "teacher", edition: 5 }],
};

const TEACHER = {
  account: READER,
  logIn: async () => {},
  register: async () => {},
  logOut: async () => {},
  chooseLocale: async () => {},
  forget: () => {},
  recheck: async () => {},
};

/** What the server answers the book. */
let answer = new Response(null, { status: 204 });

beforeEach(() => {
  vi.stubGlobal("fetch", async () => answer);
});

afterEach(async () => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
  await act(() => i18n.changeLanguage("it"));
});

/** The coded refusal of one field, its message in the browser's language. */
function refuse(violation: FieldViolation, message: string) {
  const error = {
    code: "INVALID_ARGUMENT",
    message,
    data: {},
    fields: [violation],
    request_id: null,
  };
  answer = new Response(JSON.stringify({ error }), {
    status: 400,
    headers: { "Content-Type": "application/json" },
  });
}

function type(input: HTMLInputElement | undefined, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    if (input !== undefined) setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The dialog for a new book, sent once; `refused` reads what its field says. */
async function sent(year: string) {
  const mounted = mount(
    <SessionContext value={TEACHER}>
      <ReadingDialog
        edition={5}
        book="new"
        language="it"
        onClose={() => {}}
        onChanged={async () => {}}
        onGone={async () => {}}
        onCloseAutoFocus={() => {}}
      />
    </SessionContext>,
  );
  // In the form's order: title, authors, year.
  const [title, authors, yearInput] =
    document.body.querySelectorAll<HTMLInputElement>('[role="dialog"] input');
  type(title, "Fisica II");
  type(authors, "Mazzoldi");
  type(yearInput, year);
  await act(async () => {
    title?.form?.requestSubmit();
  });
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
  const inputs = { title, year: yearInput };
  const refused = (field: keyof typeof inputs) =>
    document.getElementById(`${inputs[field]?.id}-error`)?.textContent ?? null;
  return { ...mounted, refused };
}

interface Case {
  refusal: string;
  field: "title" | "year";
  year: string;
  reason: FieldViolation["reason"];
  data: ErrorData;
  key: string;
}

const CASES: Case[] = [
  {
    refusal: "a title the list already holds",
    field: "title",
    year: "",
    reason: "ALREADY_EXISTS",
    data: {},
    key: "errors.field.title.ALREADY_EXISTS",
  },
  {
    refusal: "a year past the largest",
    field: "year",
    year: "40000",
    reason: "TOO_LARGE",
    data: { max_value: 32767 },
    key: "errors.field.TOO_LARGE",
  },
];

describe.each(UI_LOCALES)("a book refused in the %s interface", (locale) => {
  it.each(CASES)("reads $refusal in the interface's words", async (case_) => {
    const message = i18n.getFixedT(BROWSER[locale])(case_.key, case_.data);
    refuse({ field: case_.field, reason: case_.reason, data: case_.data }, message);
    await act(() => i18n.changeLanguage(locale));

    const { refused, unmount } = await sent(case_.year);
    const text = refused(case_.field);
    unmount();

    expect(text).toBe(i18n.getFixedT(locale)(case_.key, case_.data));
    expect(text).not.toContain(message);
  });
});

it("rewords a refusal under its field when the interface changes language", async () => {
  refuse({ field: "year", reason: "TOO_LARGE", data: { max_value: 32767 } }, "…");

  const { refused, unmount } = await sent("40000");
  const before = refused("year");
  await act(() => i18n.changeLanguage("en"));
  const after = refused("year");
  unmount();

  expect([before, after]).toEqual([
    "Al massimo 32767.",
    i18n.getFixedT("en")("errors.field.TOO_LARGE", { max_value: 32767 }),
  ]);
});
