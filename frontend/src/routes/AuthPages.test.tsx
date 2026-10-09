// @vitest-environment jsdom

/**
 * The two ways into an account: both take the password through PasswordField,
 * with the button that shows it and the autocomplete a password manager reads
 * (what the field does is components/PasswordField.test.tsx's subject), and a
 * registration carries the language the page is read in.
 */

import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import { SessionContext } from "@/auth/SessionProvider";
import i18n from "@/i18n";
import { mount } from "@/test/mount";
import { render } from "@/test/render";
import LoginPage from "./LoginPage";
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
