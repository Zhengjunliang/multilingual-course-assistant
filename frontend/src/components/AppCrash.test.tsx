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
