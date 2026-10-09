// @vitest-environment jsdom

/**
 * The toasts' live region is named in the interface's language. Sonner names
 * it in English unless told otherwise, and a screen reader reads that name
 * when it moves into the region.
 */

import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { mount } from "@/test/mount";
import { Toaster } from "./sonner";

describe("the toasts' region", () => {
  it("is named in the interface's language, with Sonner's shortcut after it", () => {
    const { container, unmount } = mount(<Toaster />);
    const name = container.querySelector("section")?.getAttribute("aria-label");
    unmount();

    expect({ language: i18n.resolvedLanguage, name }).toEqual({
      language: "it",
      name: `${i18n.t("app.notifications")} alt+T`,
    });
  });
});
