// @vitest-environment jsdom

/**
 * The outermost crash screen keeps what was thrown and folds it under the
 * ways on, for whoever reports it.
 */

import { afterEach, expect, it, vi } from "vitest";

import i18n from "@/i18n";
import { mount } from "@/test/mount";
import { AppCrash } from "./AppCrash";

function Broken(): never {
  throw new TypeError("the theme is missing");
}

afterEach(() => vi.restoreAllMocks());

it("folds the error it caught under a summary, closed until asked for", () => {
  // React reports a caught render error to the console; that report is not
  // what this test reads.
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { container, unmount } = mount(
    <AppCrash>
      <Broken />
    </AppCrash>,
  );
  const details = container.querySelector("details");
  const seen = {
    summary: details?.querySelector("summary")?.textContent,
    open: details?.open,
    names: details?.querySelector("pre")?.textContent?.includes("TypeError: the theme is missing"),
  };
  unmount();

  expect(seen).toEqual({ summary: i18n.t("crash.details"), open: false, names: true });
});

/** Thrown with a stack of frames alone, as Firefox and Safari write one, and no message. */
function BrokenElsewhere(): never {
  const error = new Error();
  error.stack = "render@CoursePage.tsx:12:3";
  throw error;
}

it("leads its details with what was thrown, where the stack does not say it", () => {
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { container, unmount } = mount(
    <AppCrash>
      <BrokenElsewhere />
    </AppCrash>,
  );
  const text = container.querySelector("pre")?.textContent;
  unmount();

  expect(text).toBe("Error\nrender@CoursePage.tsx:12:3");
});
