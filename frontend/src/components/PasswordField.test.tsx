// @vitest-environment jsdom

/**
 * The password field shows its letters on request and hides them again when
 * the form is sent or the page comes back from the back-forward cache. Read
 * off a mounted form, since what matters is the input's type at the moment an
 * event reads it. That Edge's own eye is hidden is a rule of index.css, read
 * in index.css.test.ts.
 */

import { act, useState } from "react";
import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { mount } from "@/test/mount";
import { PasswordField } from "./PasswordField";

function Form() {
  const [password, setPassword] = useState("segreta");
  return (
    <form onSubmit={(event) => event.preventDefault()}>
      <PasswordField
        id="password"
        autoComplete="current-password"
        value={password}
        onChange={setPassword}
      />
    </form>
  );
}

function parts(container: HTMLElement) {
  const input = container.querySelector("input");
  const button = container.querySelector("button");
  return {
    type: input?.type,
    shows: button?.textContent,
    name: button?.getAttribute("aria-label"),
    status: container.querySelector('[role="status"]')?.textContent,
  };
}

describe("a password field", () => {
  it("shows and hides its letters from a button named for them, and says which", () => {
    const { container, unmount } = mount(<Form />);
    const button = () => container.querySelector("button");
    const wiring = {
      controls: button()?.getAttribute("aria-controls"),
      pressed: button()?.hasAttribute("aria-pressed"),
      submits: button()?.type,
    };
    const before = parts(container);
    act(() => button()?.click());
    const shown = parts(container);
    act(() => button()?.click());
    const hidden = parts(container);
    unmount();

    expect({ wiring, before, shown, hidden }).toEqual({
      wiring: { controls: "password", pressed: false, submits: "button" },
      before: { type: "password", shows: "Mostra", name: "Mostra la password", status: "" },
      shown: {
        type: "text",
        shows: "Nascondi",
        name: "Nascondi la password",
        status: i18n.t("auth.passwordShown"),
      },
      hidden: {
        type: "password",
        shows: "Mostra",
        name: "Mostra la password",
        status: i18n.t("auth.passwordHidden"),
      },
    });
  });

  it("is a password again by the time the form's submit is handled", () => {
    const { container, unmount } = mount(<Form />);
    const form = container.querySelector("form");
    let typeWhenSent: string | undefined;
    form?.addEventListener("submit", () => {
      typeWhenSent = container.querySelector("input")?.type;
    });
    act(() => container.querySelector("button")?.click());
    const before = container.querySelector("input")?.type;
    act(() => {
      form?.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    });
    const after = parts(container);
    unmount();

    expect({ before, typeWhenSent, after: after.type, shows: after.shows }).toEqual({
      before: "text",
      typeWhenSent: "password",
      after: "password",
      shows: "Mostra",
    });
  });

  it("is a password again when the page is shown from the back-forward cache", () => {
    const { container, unmount } = mount(<Form />);
    act(() => container.querySelector("button")?.click());
    const before = container.querySelector("input")?.type;
    act(() => {
      window.dispatchEvent(new Event("pageshow"));
    });
    const after = container.querySelector("input")?.type;
    unmount();

    expect([before, after]).toEqual(["text", "password"]);
  });
});
