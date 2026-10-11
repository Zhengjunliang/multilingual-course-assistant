// @vitest-environment jsdom

/**
 * The password field shows its letters on request, from an eye that keeps the
 * focus in the field, and hides them again when the form is sent or the page
 * comes back from the back-forward cache. Read off a mounted form, since what
 * matters is the input's type at the moment an event reads it. That Edge's
 * own eye is hidden is a rule of index.css, read in index.css.test.ts.
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
  const button = container.querySelector("button");
  return {
    type: container.querySelector("input")?.type,
    name: button?.getAttribute("aria-label"),
    pressed: button?.getAttribute("aria-pressed"),
  };
}

describe("a password field", () => {
  it("shows and hides its letters from a toggle whose name stays and whose state follows them", () => {
    const { container, unmount } = mount(<Form />);
    const button = () => container.querySelector("button");
    const wiring = {
      controls: button()?.getAttribute("aria-controls"),
      submits: button()?.type,
      status: container.querySelectorAll('[role="status"]').length,
    };
    const before = parts(container);
    act(() => button()?.click());
    const shown = parts(container);
    act(() => button()?.click());
    const hidden = parts(container);
    unmount();

    const name = i18n.t("auth.showPassword");
    expect({ wiring, before, shown, hidden }).toEqual({
      wiring: { controls: "password", submits: "button", status: 0 },
      before: { type: "password", name, pressed: "false" },
      shown: { type: "text", name, pressed: "true" },
      hidden: { type: "password", name, pressed: "false" },
    });
  });

  it("leaves the focus in the field when the eye is pressed with a pointer", () => {
    const { container, unmount } = mount(<Form />);
    const input = container.querySelector("input");
    act(() => input?.focus());
    const press = new MouseEvent("mousedown", { bubbles: true, cancelable: true });
    container.querySelector("button")?.dispatchEvent(press);
    const kept = press.defaultPrevented;
    unmount();

    expect(kept).toBe(true);
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

    expect({ before, typeWhenSent, after: after.type, pressed: after.pressed }).toEqual({
      before: "text",
      typeWhenSent: "password",
      after: "password",
      pressed: "false",
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
