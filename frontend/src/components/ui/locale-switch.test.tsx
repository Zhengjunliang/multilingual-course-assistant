// @vitest-environment jsdom

/**
 * The language menu, asserted by opening it with a pointer press, the way
 * dropdown-menu.test.tsx records Radix wants.
 */

import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { LocaleSwitch } from "@/components/ui/locale-switch";
import { mount } from "@/test/mount";

function press(element: Element) {
  act(() => {
    element.dispatchEvent(
      new PointerEvent("pointerdown", { bubbles: true, button: 0, ctrlKey: false }),
    );
  });
}

function opened(onChange: (locale: string) => void = () => {}) {
  const mounted = mount(
    <LocaleSwitch
      locales={["it", "en", "zh-hans"]}
      value="it"
      label="Lingua"
      onChange={onChange}
    />,
  );
  const trigger = mounted.container.querySelector("button");
  if (trigger !== null) press(trigger);
  return mounted;
}

function entries(): HTMLElement[] {
  return [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')];
}

describe("the language menu", () => {
  it("shows the language in use, in itself, and names the trigger", () => {
    const { container, unmount } = mount(
      <LocaleSwitch locales={["it", "en"]} value="it" label="Lingua" onChange={() => {}} />,
    );

    expect(container.querySelector("button")?.textContent).toBe("LinguaItaliano");
    expect(document.body.querySelector('[role="menu"]')).toBeNull();

    unmount();
  });

  it("names each language in itself, in its own language", () => {
    const { unmount } = opened();

    expect(entries().map((entry) => [entry.getAttribute("lang"), entry.textContent])).toEqual([
      ["it", "Italiano"],
      ["en", "English"],
      ["zh-hans", "简体中文"],
    ]);

    unmount();
  });

  it("marks the language in use as the chosen one", () => {
    const { unmount } = opened();

    expect(entries().map((entry) => entry.getAttribute("aria-checked"))).toEqual([
      "true",
      "false",
      "false",
    ]);

    unmount();
  });

  it("hands the chosen language to its caller", () => {
    const onChange = vi.fn();
    const { unmount } = opened(onChange);

    act(() => entries()[2]?.click());
    expect(onChange).toHaveBeenCalledWith("zh-hans");

    unmount();
  });
});
