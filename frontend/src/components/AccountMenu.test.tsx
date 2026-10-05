// @vitest-environment jsdom

/**
 * What the account menu offers each kind of account. The staff pages are not
 * among its items: they are the sidebar's Gestione group. The Django admin is,
 * for the superuser alone, above "Esci".
 */

import { act } from "react";
import { describe, expect, it } from "vitest";

import type { Account } from "@/api/account";
import { SessionContext } from "@/auth/SessionProvider";
import { mount } from "@/test/mount";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { AccountMenu } from "./AccountMenu";

function account(superuser: boolean, roles: Account["roles"]): Account {
  return { id: 1, username: "reader", locale: "it", is_superuser: superuser, roles };
}

describe("the account menu", () => {
  it.each([
    ["a student", account(false, []), ["Account", "Esci"]],
    [
      "secretariat staff",
      account(false, [{ role: "secretariat", programme: "B047" }]),
      ["Account", "Esci"],
    ],
    ["the superuser", account(true, []), ["Account", "Amministrazione", "Esci"]],
  ])("offers %s its items", (_, reader, items) => {
    const { container, unmount } = mount(
      <SessionContext
        value={{
          account: reader,
          logIn: async () => {},
          register: async () => {},
          logOut: async () => {},
          chooseLocale: async () => {},
          forget: () => {},
        }}
      >
        <ThemeProvider>
          <AccountMenu />
        </ThemeProvider>
      </SessionContext>,
    );
    act(() => {
      container
        .querySelector("button")
        ?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
    });
    const offered = [...document.body.querySelectorAll('[role="menuitem"]')].map((item) =>
      item.textContent?.trim(),
    );
    unmount();

    expect(offered).toEqual(items);
  });
});
