// @vitest-environment jsdom

/**
 * The densest new surface in this interface, and the reason the suite has a
 * document at all.
 *
 * Eight things have to be on screen at once — a name, three themes, three
 * languages and a way out — and every one of them is inside a Radix portal, so
 * a string render returns the empty string and proves nothing. Before the
 * document, this whole screen would have been a line on the manual checklist,
 * re-walked by hand after every change.
 *
 * `ThemeProvider` is the real one rather than a fake context, because the
 * assertion worth making is that clicking "dark" *changes the theme* — which
 * `ThemeProvider` records by writing `data-theme` on the document element — and
 * not merely that a spy was called. That works here only because
 * `test/setup.ts` stands in for `matchMedia`, which jsdom does not have.
 */

import { act } from "react";
import { describe, expect, it } from "vitest";

import { SessionContext } from "@/auth/SessionProvider";
import { AccountDialog } from "@/components/AccountDialog";
import { mount } from "@/test/mount";
import { ThemeProvider } from "@/theme/ThemeProvider";

function dialog() {
  return mount(
    <ThemeProvider>
      <SessionContext
        value={{
          account: { id: 1, username: "junliang", locale: "it" },
          logIn: async () => {},
          register: async () => {},
          logOut: async () => {},
          chooseLocale: async () => {},
          forget: () => {},
        }}
      >
        <AccountDialog open onOpenChange={() => {}} />
      </SessionContext>
    </ThemeProvider>,
  );
}

function buttonLabelled(text: string) {
  return [...document.body.querySelectorAll("button")].find((b) => b.textContent?.includes(text));
}

describe("the account dialog", () => {
  it("names who is signed in", () => {
    const { unmount } = dialog();

    expect(document.body.textContent).toContain("junliang");
    expect(document.body.textContent).toContain("Profilo");

    unmount();
  });

  it("offers all three themes and says the choice is per device", () => {
    const { unmount } = dialog();

    for (const label of ["Di sistema", "Chiaro", "Scuro"]) {
      expect(buttonLabelled(label)).toBeDefined();
    }
    // The distinction ThemeProvider argues for, in front of the reader rather
    // than only in a source comment.
    expect(document.body.textContent).toContain("questo dispositivo");

    unmount();
  });

  it("offers all three interface languages", () => {
    const { unmount } = dialog();

    for (const locale of ["it", "en", "zh-hans"]) {
      expect(buttonLabelled(locale)).toBeDefined();
    }

    unmount();
  });

  it("actually changes the theme when one is chosen", () => {
    const { unmount } = dialog();

    act(() => buttonLabelled("Scuro")?.click());
    expect(document.documentElement.dataset.theme).toBe("dark");

    act(() => buttonLabelled("Chiaro")?.click());
    expect(document.documentElement.dataset.theme).toBe("light");

    unmount();
  });

  it("keeps a way out of the session", () => {
    const { unmount } = dialog();

    expect(buttonLabelled("Esci")).toBeDefined();

    unmount();
  });
});
