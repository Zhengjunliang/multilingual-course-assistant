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
      hint="Le risposte seguono la lingua della domanda."
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
    const trigger = container.querySelector("button");
    const heard = [...(trigger?.querySelectorAll(".sr-only, [lang]") ?? [])].map(
      (part) => part.textContent,
    );

    expect({ heard, code: trigger?.querySelector("span[aria-hidden=true]")?.textContent }).toEqual({
      heard: ["Lingua", "Italiano"],
      code: "IT",
    });
    expect(document.body.querySelector('[role="menu"]')).toBeNull();

    unmount();
  });

  it("names each language in itself, in its own language", () => {
    const { unmount } = opened();

    const named = entries().map((entry) => entry.querySelector("[lang]"));

    expect(named.map((name) => [name?.getAttribute("lang"), name?.textContent])).toEqual([
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

  it("names each other language in the interface's too, and says what the choice leaves alone", () => {
    const { unmount } = opened();
    const glosses = entries().map((entry) => entry.querySelector(".text-muted")?.textContent);
    const hint = document.body.querySelector('[role="menu"]')?.lastElementChild?.textContent;
    unmount();

    expect({ own: glosses[0], english: glosses[1], hint }).toEqual({
      own: "",
      english: "inglese",
      hint: "Le risposte seguono la lingua della domanda.",
    });
  });
});
