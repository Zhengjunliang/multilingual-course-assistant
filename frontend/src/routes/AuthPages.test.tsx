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

import { ApiError } from "@/api/http";
import { SessionContext } from "@/auth/SessionProvider";
import i18n from "@/i18n";
import { mount } from "@/test/mount";
import { render } from "@/test/render";
import LoginPage from "./LoginPage";
import { ACCEPTED_FOR, CROUCH, leapt } from "./landing";
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

function signIn(logIn: () => Promise<void>, from?: string) {
  return mount(
    <SessionContext value={{ ...VISITOR, logIn }}>
      <MemoryRouter
        initialEntries={[{ pathname: "/login", state: from === undefined ? null : { from } }]}
      >
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/" element={<p id="front" />} />
          <Route path="/c/7" element={<p id="thread" />} />
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

  it("accepted: the check shows, the cat crouches, and it jumps to the entry", async () => {
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
    const crouching = {
      cat: container
        .querySelector("[data-living-mascot]")
        ?.parentElement?.classList.contains("crouch"),
      left: container.querySelector("#front") !== null,
    };
    await act(async () => {
      vi.advanceTimersByTime(CROUCH);
    });
    const landed = { left: container.querySelector("#front") !== null, leapt: leapt() };
    unmount();

    expect({ checking, crouching, landed }).toEqual({
      checking: { busy: "true", left: false },
      crouching: { cat: true, left: false },
      landed: { left: true, leapt: true },
    });
  });

  it("accepted on the way to another page: it goes there after the check, with no jump", async () => {
    vi.useFakeTimers();
    const { container, unmount } = signIn(async () => {}, "/c/7");
    await send(container);
    await act(async () => {
      vi.advanceTimersByTime(ACCEPTED_FOR);
    });
    const arrived = container.querySelector("#thread") !== null;
    unmount();

    expect(arrived).toBe(true);
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

  it.each([
    {
      refusal: "a password the validators refuse: the focus goes to it, described",
      error: new ApiError(400, "Invalid input.", { password: ["This password is too common."] }),
      after: { focused: "password", invalid: "true", alert: null },
    },
    {
      refusal: "a failure no field carries: it is an alert",
      error: new ApiError(429, "Troppi tentativi."),
      after: { focused: "", invalid: null, alert: "Troppi tentativi." },
    },
  ])("refused, $refusal", async ({ error, after }) => {
    const register = async () => {
      throw error;
    };
    const { container, unmount } = mount(
      <SessionContext value={{ ...VISITOR, register }}>
        <MemoryRouter>
          <RegisterPage />
        </MemoryRouter>
      </SessionContext>,
    );
    type(container.querySelector<HTMLInputElement>("#username"), "ada");
    type(container.querySelector<HTMLInputElement>("#password"), "password");
    await act(async () => {
      container.querySelector("form")?.requestSubmit();
    });
    const state = {
      focused: document.activeElement?.id,
      invalid: container.querySelector("#password")?.getAttribute("aria-invalid") ?? null,
      alert: container.querySelector("[role=alert]")?.textContent?.replace(/^!/, "") ?? null,
    };
    unmount();

    expect(state).toEqual(after);
  });
});
