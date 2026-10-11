// @vitest-environment jsdom

/**
 * The two ways into an account: both take the password through PasswordField,
 * with the eye that shows it and the autocomplete a password manager reads
 * (what the field does is components/PasswordField.test.tsx's subject); a
 * refused sign-in empties the password and an accepted one shows its check
 * before it leaves (routes/landing.ts); a registration carries the language
 * the page is read in.
 */

import { act } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SessionContext } from "@/auth/SessionProvider";
import i18n from "@/i18n";
import { mount } from "@/test/mount";
import { render } from "@/test/render";
import LoginPage from "./LoginPage";
import { ACCEPTED_FOR } from "./landing";
import RegisterPage from "./RegisterPage";

const VISITOR = {
  account: null,
  logIn: async () => {},
  register: async () => {},
  logOut: async () => {},
  chooseLocale: async () => {},
  forget: () => {},
  recheck: async () => {},
};

function page(form: React.ReactElement): string {
  return render(
    <SessionContext value={VISITOR}>
      <MemoryRouter>{form}</MemoryRouter>
    </SessionContext>,
  );
}

describe("the password of a sign-in form", () => {
  it.each([
    { form: "sign-in", html: () => page(<LoginPage />), autocomplete: "current-password" },
    { form: "registration", html: () => page(<RegisterPage />), autocomplete: "new-password" },
  ])("can be shown on the $form form", ({ html, autocomplete }) => {
    const markup = html();

    expect(markup).toMatch(
      new RegExp(`<input[^>]*type="password"[^>]*autoComplete="${autocomplete}"`, "i"),
    );
    expect(markup).toMatch(
      /<button[^>]*aria-controls="password"[^>]*aria-label="Mostra la password"/,
    );
  });
});

function type(input: HTMLInputElement | null, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    if (input !== null) setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function signIn(logIn: () => Promise<void>) {
  return mount(
    <SessionContext value={{ ...VISITOR, logIn }}>
      <MemoryRouter initialEntries={["/login"]}>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p id="front" />} />
        </Routes>
      </MemoryRouter>
    </SessionContext>,
  );
}

async function send(container: HTMLElement) {
  type(container.querySelector<HTMLInputElement>("#username"), "ada");
  type(container.querySelector<HTMLInputElement>("#password"), "segreta");
  await act(async () => {
    container.querySelector("form")?.requestSubmit();
  });
}

describe("a sign-in", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("refused: the password is emptied and focused, and described by what was said", async () => {
    const { container, unmount } = signIn(async () => {
      throw new Error("refused");
    });
    await send(container);
    const field = container.querySelector<HTMLInputElement>("#password");
    const described = document.getElementById(field?.getAttribute("aria-describedby") ?? "");
    const after = {
      value: field?.value,
      focused: document.activeElement === field,
      invalid: field?.getAttribute("aria-invalid"),
      says: described?.textContent?.endsWith(i18n.t("auth.failed")),
    };
    unmount();

    expect(after).toEqual({ value: "", focused: true, invalid: "true", says: true });
  });

  it("accepted: the check shows, and then the page leaves for where the reader was going", async () => {
    vi.useFakeTimers();
    const { container, unmount } = signIn(async () => {});
    await send(container);
    const checking = {
      busy: container.querySelector("button[type=submit]")?.getAttribute("aria-disabled"),
      left: container.querySelector("#front") !== null,
    };
    await act(async () => {
      vi.advanceTimersByTime(ACCEPTED_FOR);
    });
    const left = container.querySelector("#front") !== null;
    unmount();

    expect({ checking, left }).toEqual({ checking: { busy: "true", left: false }, left: true });
  });
});

describe("a registration", () => {
  it("makes the language the page is read in the account's", async () => {
    await act(() => i18n.changeLanguage("zh-hans"));
    const register = vi.fn(async () => {});
    const { container, unmount } = mount(
      <SessionContext value={{ ...VISITOR, register }}>
        <MemoryRouter>
          <RegisterPage />
        </MemoryRouter>
      </SessionContext>,
    );
    type(container.querySelector<HTMLInputElement>("#username"), "ada");
    type(container.querySelector<HTMLInputElement>("#password"), "segreta-lunga");
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });
    unmount();
    await act(() => i18n.changeLanguage("it"));

    expect(register).toHaveBeenCalledWith("ada", "segreta-lunga", "zh-hans");
  });
});
