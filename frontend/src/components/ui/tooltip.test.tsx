// @vitest-environment jsdom

/**
 * A hint opens for keyboard focus, not only for a resting pointer, and Escape
 * closes it: the two things the `title` attribute it replaces cannot do. Read
 * off a mounted tree, as the hint opens in a portal at the end of the body.
 */

import { act } from "react";
import { describe, expect, it } from "vitest";

import { mount } from "@/test/mount";
import { Tooltip } from "./tooltip";

describe("a tooltip", () => {
  it("opens on focus, describes its trigger, and closes on Escape", () => {
    const { container, unmount } = mount(
      <Tooltip content="[PPM 3]">
        <button type="button" aria-label="Fonte 1: [PPM 3]">
          1
        </button>
      </Tooltip>,
    );
    const trigger = container.querySelector("button");
    const hint = () => document.body.querySelector('[role="tooltip"]');

    const before = hint();
    act(() => trigger?.focus());
    const open = {
      says: hint()?.textContent,
      describes: trigger?.getAttribute("aria-describedby") === hint()?.id,
    };
    act(() => {
      trigger?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    const after = hint();
    unmount();

    expect({ before, open, after }).toEqual({
      before: null,
      open: { says: "[PPM 3]", describes: true },
      after: null,
    });
  });
});
