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
import { INTRO, LINES } from "./intro";

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
      const shown = [...(h2?.childNodes ?? [])]
        .filter((node) => !(node instanceof Element && node.classList.contains("invisible")))
        .map((node) => node.textContent)
        .join("");
      return { name: h2?.getAttribute("aria-label") ?? h2?.textContent, shown };
    },
    // Held where the writing is: in the one cell of the heading's grid, cut
    // into the same graphemes, so that they wrap as it would.
    held: () => {
      const h2 = container.querySelector("h2");
      const cell = (line: Element) =>
        line.classList.contains("col-start-1") && line.classList.contains("row-start-1");
      return {
        grid: h2?.classList.contains("grid"),
        writingInCell: [...(h2?.children ?? [])].every(cell),
        lines: [...container.querySelectorAll("h2 > .invisible")].map((line) => ({
          lang: line.getAttribute("lang"),
          text: line.textContent,
          hidden: line.getAttribute("aria-hidden"),
          cut: line.querySelector(":scope > span > span.inline-block") !== null,
        })),
      };
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

  it("holds every line it writes and the caption unseen in the cell the writing takes", () => {
    systemReducesMotion(false);
    const page = entry();
    const start = page.held();
    act(() => vi.advanceTimersByTime(INTRO.length * 1000 + 10));
    const settled = page.held();
    page.unmount();

    const held = {
      grid: true,
      writingInCell: true,
      lines: [...LINES, { lang: "it", text: "Chiedi in qualsiasi lingua." }].map((line) => ({
        ...line,
        hidden: "true",
        cut: true,
      })),
    };
    expect({ start, settled }).toEqual({ start: held, settled: held });
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

  it("stops drawing the cat in when skipped", () => {
    systemReducesMotion(false);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => frames.push(callback)),
    );
    const page = entry();
    const outline = () =>
      page.container.querySelector<SVGPathElement>('[data-part="outline"]')?.style.strokeDasharray;
    act(() => {
      for (const frame of frames.splice(0)) frame(1000);
    });
    const drawing = outline();
    act(() => page.skip()?.click());
    act(() => {
      for (const frame of frames.splice(0)) frame(1100);
    });
    const skipped = outline();
    page.unmount();

    expect({ drawing, skipped }).toEqual({ drawing: "1 1", skipped: "" });
  });

  it("hands the focus from Skip to the question box when the intro ends by itself", () => {
    systemReducesMotion(false);
    const question = document.createElement("textarea");
    question.id = "question";
    document.body.append(question);
    const page = entry();
    act(() => page.skip()?.focus());
    act(() => vi.advanceTimersByTime(INTRO.length * 1000 + 10));
    const focused = document.activeElement === question;
    page.unmount();
    question.remove();

    expect(focused).toBe(true);
  });

  it("leaves the focus where a reader moved it after Skip when the intro ends", () => {
    systemReducesMotion(false);
    const question = document.createElement("textarea");
    question.id = "question";
    document.body.append(question);
    const page = entry();
    const chip = () =>
      [...page.container.querySelectorAll("button")].find((button) =>
        button.textContent?.includes("iscrizione"),
      );
    act(() => page.skip()?.focus());
    act(() => page.skip()?.blur());
    act(() => chip()?.focus());
    act(() => vi.advanceTimersByTime(INTRO.length * 1000 + 10));
    const focused = document.activeElement === chip();
    page.unmount();
    question.remove();

    expect(focused).toBe(true);
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
