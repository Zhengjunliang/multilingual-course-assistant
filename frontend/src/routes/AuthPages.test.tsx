/**
 * Both ways into an account take the password through PasswordField, with the
 * button that shows it and the autocomplete a password manager reads. What
 * the field does is components/PasswordField.test.tsx's subject; this holds
 * that the two forms use it.
 */

import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import { SessionContext } from "@/auth/SessionProvider";
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
