// @vitest-environment jsdom

/**
 * What the account row and its menu offer each kind of account. The staff
 * pages are not among its items: they are the sidebar's Gestione group. The
 * Django admin is, for the superuser alone; the language is at the first
 * level, showing the one in use, and choosing one goes to the account. A
 * sign-out the server never answered says so, the account still signed in.
 */

import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";

import type { Account } from "@/api/account";
import { SessionContext } from "@/auth/SessionProvider";
import { Toaster } from "@/components/ui/sonner";
import i18n, { type UiLocale } from "@/i18n";
import { mount } from "@/test/mount";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { AccountMenu } from "./AccountMenu";

function account(superuser: boolean, roles: Account["roles"]): Account {
  return { id: 1, username: "reader", locale: "it", is_superuser: superuser, roles };
}

function menu(
  reader: Account,
  { chooseLocale = async () => {}, onOpenSettings = () => {}, logOut = async () => {} } = {} as {
    chooseLocale?: (locale: UiLocale) => Promise<void>;
    onOpenSettings?: () => void;
    logOut?: () => Promise<void>;
  },
) {
  const mounted = mount(
    <SessionContext
      value={{
        account: reader,
        logIn: async () => {},
        register: async () => {},
        logOut,
        chooseLocale,
        forget: () => {},
        recheck: async () => {},
      }}
    >
      <ThemeProvider>
        <MemoryRouter>
          <AccountMenu onOpenSettings={onOpenSettings} onOpenHelp={() => {}} />
        </MemoryRouter>
        <Toaster />
      </ThemeProvider>
    </SessionContext>,
  );
  const row = mounted.container.querySelector("button");
  // Radix opens a menu on pointerdown, not on click (dropdown-menu.test.tsx).
  act(() => {
    row?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  });
  return { ...mounted, row };
}

const items = () => [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')];

describe("the account row and its menu", () => {
  it.each([
    [
      "a student",
      account(false, []),
      "Studente",
      ["Il mio account", "Lingua", "Impostazioni…", "Aiuto e scorciatoie", "Esci"],
    ],
    [
      "secretariat staff",
      account(false, [{ role: "secretariat", programme: "B047" }]),
      "Segreteria",
      ["Il mio account", "Lingua", "Impostazioni…", "Aiuto e scorciatoie", "Esci"],
    ],
    [
      "the superuser",
      account(true, []),
      "Amministratore",
      [
        "Il mio account",
        "Lingua",
        "Impostazioni…",
        "Aiuto e scorciatoie",
        "Amministrazione",
        "Esci",
      ],
    ],
  ])("name %s, its role, and offer its items", (_, reader, role, labels) => {
    const { row, unmount } = menu(reader);
    const named = row?.textContent;
    const offered = items().map((item) => item.textContent ?? "");
    unmount();

    expect(named).toContain("reader");
    expect(named).toContain(role);
    // Each item's text starts with its label; a key's cap may follow it.
    expect(offered.map((text, index) => text.startsWith(labels[index] ?? "\0"))).toEqual(
      labels.map(() => true),
    );
  });

  it("show the language in use at the first level, and send a new one to the account", () => {
    const chooseLocale = vi.fn(async () => {});
    const { unmount } = menu(account(false, []), { chooseLocale });
    const language = items().find((item) => item.getAttribute("aria-haspopup") === "menu");
    expect(language?.textContent).toContain("Italiano");

    act(() => {
      language?.focus();
      language?.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    });
    const english = [...document.body.querySelectorAll<HTMLElement>('[role="menuitemradio"]')].find(
      // Its code on a chip, then its name.
      (option) => option.textContent === "ENEnglish",
    );
    act(() => english?.click());
    unmount();

    expect(chooseLocale).toHaveBeenCalledWith("en");
  });

  it("open the settings once the menu has closed", async () => {
    const onOpenSettings = vi.fn();
    const { unmount } = menu(account(false, []), { onOpenSettings });
    const settings = items().find((item) => item.textContent?.startsWith("Impostazioni"));

    act(() => settings?.click());
    // Radix gives the focus back, and calls `onCloseAutoFocus`, in a task of its own.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    unmount();

    expect(onOpenSettings).toHaveBeenCalledOnce();
  });

  it("says a sign-out the server never answered in a toast", async () => {
    const { unmount } = menu(account(false, []), {
      logOut: async () => {
        throw new TypeError("Failed to fetch");
      },
    });
    const logOut = items().find((item) => item.textContent?.startsWith("Esci"));

    await act(async () => {
      logOut?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const said = document.body.querySelector("[data-sonner-toast]")?.textContent;
    unmount();

    expect(said).toContain(i18n.t("account.logOutFailed"));
    expect(said).toContain(i18n.t("errors.NETWORK"));
  });
});
