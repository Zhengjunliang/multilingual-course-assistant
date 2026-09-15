// @vitest-environment jsdom

/**
 * The menu, asserted by opening it.
 *
 * Worth recording how: `trigger.click()` does not open a Radix menu. Radix
 * listens on `pointerdown`, and `HTMLElement.click()` dispatches a bare `click`
 * and nothing before it. The received wisdom is that this makes a Radix menu
 * untestable without `@testing-library/user-event` — that is true of jsdom
 * versions without `PointerEvent`, and jsdom 30 has it. Two lines of
 * `dispatchEvent` do the job and the dependency stays out.
 *
 * `button: 0` and no ctrl key because that is exactly what Radix checks before
 * it treats a pointer press as a request to open.
 */

import { LogOut, UserRound } from "lucide-react";
import { act } from "react";
import { describe, expect, it } from "vitest";

import { Avatar } from "@/components/ui/avatar";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { mount } from "@/test/mount";

function press(element: Element) {
  act(() => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
    );
  });
}

function menu() {
  return mount(
    <DropdownMenu
      ariaLabel="Account"
      trigger={<Avatar name="junliang" />}
      label="junliang"
      caption="Studente"
      entries={[
        { key: "account", icon: UserRound, label: "Account", onSelect: () => {} },
        { key: "logout", icon: LogOut, label: "Esci", onSelect: () => {} },
      ]}
    />,
  );
}

describe("the account menu", () => {
  it("shows nothing but its trigger until it is opened", () => {
    const { unmount } = menu();

    expect(document.body.textContent).not.toContain("Esci");

    unmount();
  });

  it("opens on a pointer press and names who is signed in", () => {
    const { container, unmount } = menu();
    const trigger = container.querySelector("button");

    expect(trigger).not.toBeNull();
    if (trigger !== null) press(trigger);

    expect(document.body.textContent).toContain("junliang");
    expect(document.body.textContent).toContain("Account");
    expect(document.body.textContent).toContain("Esci");

    unmount();
  });

  it("tells a screen reader what the trigger is", () => {
    const { container, unmount } = menu();

    expect(container.querySelector("button")?.getAttribute("aria-label")).toBe("Account");

    unmount();
  });
});
