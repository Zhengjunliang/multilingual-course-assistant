// @vitest-environment jsdom

/**
 * The tabs, asserted by switching them: the panel not shown is hidden, and
 * what the reader typed in a panel is still there after a look at another.
 */

import { act } from "react";
import { describe, expect, it } from "vitest";

import { Tabs } from "@/components/ui/tabs";
import { mount } from "@/test/mount";

/** A press on a tab as a pointer makes it: Radix's trigger answers the mousedown. */
function press(tab: Element | undefined) {
  act(() => {
    tab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
}

describe("the tabs", () => {
  it("hide the panel not shown and keep what was typed in it", () => {
    const { container, unmount } = mount(
      <Tabs
        label="Corso di laurea"
        defaultValue="plan"
        tabs={[
          {
            value: "plan",
            label: "Piano di studi", // spellchecker:disable-line
            count: 2,
            content: <input aria-label="Filtra" />,
          },
          { value: "staff", label: "Segreteria didattica", count: 1, content: <p>Giulia Neri</p> },
        ]}
      />,
    );
    const [plan, staff] = container.querySelectorAll('[role="tab"]');
    const panels = () =>
      [...container.querySelectorAll('[role="tabpanel"]')].map((panel) =>
        panel.classList.contains("data-[state=inactive]:hidden")
          ? panel.getAttribute("data-state")
          : "always shown",
      );
    const input = container.querySelector("input");
    if (input !== null) input.value = "basi";

    press(staff);
    const whileAway = panels();
    press(plan);
    const kept = container.querySelector("input")?.value;
    unmount();

    expect(whileAway).toEqual(["inactive", "active"]);
    expect(kept).toBe("basi");
  });
});
