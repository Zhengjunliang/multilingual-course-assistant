// @vitest-environment jsdom

/**
 * The intro plays on a visitor's first visit only, once, skippable, and never
 * with reduced motion; the caption's name stays the settled sentence while
 * the letters run through six languages. Timed on a fake clock.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { mount } from "@/test/mount";
import { EntryScreen } from "./EntryScreen";
import { INTRO } from "./intro";

function systemReducesMotion(reduce: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: reduce && query.includes("reduce"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

function entry(visitor = true) {
  const mounted = mount(<EntryScreen onPick={() => {}} visitor={visitor} />);
  const { container } = mounted;
  return {
    ...mounted,
    skip: () =>
      [...container.querySelectorAll("button")].find((button) => button.textContent === "Salta"),
    heading: () => {
      const h2 = container.querySelector("h2");
      return { name: h2?.getAttribute("aria-label") ?? h2?.textContent, shown: h2?.textContent };
    },
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.stubGlobal(
    "requestAnimationFrame",
    vi.fn(() => 1),
  );
});

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("the entry's intro", () => {
  it("writes the question in each language under a steady name, then settles", () => {
    systemReducesMotion(false);
    const page = entry();
    const start = { skip: page.skip() !== undefined, seen: localStorage.getItem("mca.intro") };
    act(() => vi.advanceTimersByTime((INTRO.firstLine + 2 * INTRO.perLine) * 1000 + 10));
    const third = page.heading();
    act(() => vi.advanceTimersByTime(INTRO.length * 1000));
    const settled = { ...page.heading(), skip: page.skip() !== undefined };
    page.unmount();

    expect({ start, third, settled }).toEqual({
      start: { skip: true, seen: "seen" },
      third: { name: "Chiedi in qualsiasi lingua.", shown: "3号教室在哪里？" },
      settled: {
        name: "Chiedi in qualsiasi lingua.",
        shown: "Chiedi in qualsiasi lingua.",
        skip: false,
      },
    });
  });

  it("stops at Skip and hands the focus to the question box", () => {
    systemReducesMotion(false);
    const question = document.createElement("textarea");
    question.id = "question";
    document.body.append(question);
    const page = entry();
    act(() => page.skip()?.click());
    const after = { skip: page.skip() !== undefined, focused: document.activeElement === question };
    page.unmount();
    question.remove();

    expect(after).toEqual({ skip: false, focused: true });
  });

  it("plays once: a second visit opens on the caption at rest", () => {
    systemReducesMotion(false);
    localStorage.setItem("mca.intro", "seen");
    const page = entry();
    const again = { skip: page.skip() !== undefined, heading: page.heading() };
    page.unmount();

    expect(again).toEqual({
      skip: false,
      heading: { name: "Chiedi in qualsiasi lingua.", shown: "Chiedi in qualsiasi lingua." },
    });
  });

  it.each([
    ["a signed-in reader", false, false],
    ["reduced motion", true, true],
  ])("does not play for %s", (_, visitor, reduce) => {
    systemReducesMotion(reduce);
    const page = entry(visitor);
    const skip = page.skip() !== undefined;
    page.unmount();

    expect({ skip, seen: localStorage.getItem("mca.intro") }).toEqual({ skip: false, seen: null });
  });
});
