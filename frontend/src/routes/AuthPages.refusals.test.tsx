// @vitest-environment jsdom

/**
 * A refused sign-in or registration reads in the interface's language, whatever
 * the browser and the server speak (#186). The page finds its sentence by the
 * error's code, so the server's message — here the sentence of the browser's
 * language — never reaches the reader; a change of language rewords a refusal
 * already on screen; and a failure the reader can only report shows its code
 * and request id.
 */

import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import { ERROR_CODES, type ErrorCode, type ErrorData, type FieldViolation } from "@/api/errors";
import { failureOf } from "@/api/http";
import { SessionContext } from "@/auth/SessionProvider";
import i18n, { UI_LOCALES, type UiLocale } from "@/i18n";
import { mount } from "@/test/mount";
import LoginPage from "./LoginPage";
import RegisterPage from "./RegisterPage";

const ID = "4bf92f3577b34da6a3ce929d0e0e4736";

/** The browser's language, which the server's message follows: never the page's. */
const BROWSER: Record<UiLocale, UiLocale> = { it: "en", en: "zh-hans", "zh-hans": "it" };

const VISITOR = {
  account: null,
  logIn: async () => {},
  register: async () => {},
  logOut: async () => {},
  chooseLocale: async () => {},
  forget: () => {},
  recheck: async () => {},
};

function type(input: HTMLInputElement | null, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    if (input !== null) setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The page, sent once and refused with `error`. */
async function refused(form: "login" | "register", error: unknown) {
  const refuse = async () => {
    throw error;
  };
  const mounted = mount(
    <SessionContext value={{ ...VISITOR, logIn: refuse, register: refuse }}>
      <MemoryRouter>{form === "login" ? <LoginPage /> : <RegisterPage />}</MemoryRouter>
    </SessionContext>,
  );
  type(mounted.container.querySelector<HTMLInputElement>("#username"), "ada");
  type(mounted.container.querySelector<HTMLInputElement>("#password"), "password");
  await act(async () => {
    mounted.container.querySelector("form")?.requestSubmit();
  });
  return mounted;
}

/** The coded body the server sends, its message in the browser's language, read as `request()` reads it. */
function coded(status: number, code: ErrorCode, message: string, fields: FieldViolation[] = []) {
  const body = { error: { code, message, data: {}, fields, request_id: ID } };
  return failureOf(new Response(JSON.stringify(body), { status }));
}

interface Case {
  refusal: string;
  form: "login" | "register";
  /** The element the sentence is shown in. */
  shown: string;
  code: ErrorCode;
  fields: FieldViolation[];
  key: string;
  values: ErrorData;
}

function onField(
  field: string,
  reason: FieldViolation["reason"],
  key: string,
  data: ErrorData = {},
): Case {
  return {
    refusal: `${field} ${reason}`,
    form: "register",
    shown: `#${field}-refused`,
    code: "INVALID_ARGUMENT",
    fields: [{ field, reason, data }],
    key,
    values: data,
  };
}

const CASES: Case[] = [
  {
    refusal: "a wrong password",
    form: "login",
    shown: "#login-failure",
    code: "WRONG_CREDENTIALS",
    fields: [],
    key: "errors.WRONG_CREDENTIALS",
    values: {},
  },
  onField("username", "ALREADY_EXISTS", "errors.field.username.ALREADY_EXISTS"),
  onField("username", "INVALID", "errors.field.username.INVALID"),
  onField("password", "TOO_SHORT", "errors.field.TOO_SHORT", { min_length: 8 }),
  onField("password", "TOO_COMMON", "errors.field.TOO_COMMON"),
  onField("password", "ENTIRELY_NUMERIC", "errors.field.ENTIRELY_NUMERIC"),
  onField("password", "TOO_SIMILAR", "errors.field.TOO_SIMILAR"),
];

afterEach(async () => {
  await act(() => i18n.changeLanguage("it"));
});

describe.each(UI_LOCALES)("a refusal in the %s interface", (locale) => {
  it.each(CASES)("reads $refusal in the interface's words", async (case_) => {
    const message = i18n.getFixedT(BROWSER[locale])(case_.key, case_.values);
    const error = await coded(ERROR_CODES[case_.code].status, case_.code, message, case_.fields);
    await act(() => i18n.changeLanguage(locale));

    const { container, unmount } = await refused(case_.form, error);
    const text = container.querySelector(case_.shown)?.textContent;
    unmount();

    expect(text).toBe(i18n.getFixedT(locale)(case_.key, case_.values));
    expect(text).not.toContain(message);
  });
});

it("rewords a refusal on screen when the interface changes language", async () => {
  const error = await coded(400, "INVALID_ARGUMENT", "…", [
    { field: "password", reason: "TOO_SHORT", data: { min_length: 8 } },
  ]);

  const { container, unmount } = await refused("register", error);
  const before = container.querySelector("#password-refused")?.textContent;
  await act(() => i18n.changeLanguage("en"));
  const after = container.querySelector("#password-refused")?.textContent;
  unmount();

  expect([before, after]).toEqual([
    "Almeno 8 caratteri.",
    i18n.getFixedT("en")("errors.field.TOO_SHORT", { min_length: 8 }),
  ]);
});

it.each([
  [
    "the server's, with the request id",
    () => coded(500, "INTERNAL", "Boom."),
    `INTERNAL · rif. ${ID}`,
  ],
  ["the network's, with none", async () => new TypeError("Failed to fetch"), "NETWORK"],
])("adds the code under a failure to report: %s", async (_, failure, reference) => {
  const { container, unmount } = await refused("login", await failure());
  const text = container.querySelector("#login-failure")?.textContent ?? "";
  unmount();

  expect(text.slice(-reference.length)).toBe(reference);
});
