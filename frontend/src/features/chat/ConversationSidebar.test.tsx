// @vitest-environment jsdom

/**
 * The sidebar's states and its delete action, where the page cannot show
 * them: rows on their way, no conversations at all, a search that finds
 * nothing, and where focus goes when a deletion is cancelled.
 *
 * Deleting through the dialog, and where the page goes afterwards, is asserted
 * on the whole application: in routes/ChatPage.routing.test.tsx, and with an
 * answer being written in routes/staff.routing.test.tsx.
 */

import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { ConversationSummary } from "@/api/conversations";
import { SessionContext } from "@/auth/SessionProvider";
import i18n from "@/i18n";
import { summary } from "@/test/conversations";
import { mount } from "@/test/mount";
import { ConversationSidebar } from "./ConversationSidebar";

const ROWS: ConversationSummary[] = [
  summary({ id: 7, created_at: "2026-09-28T10:00:00Z", title: "Che cos'è un ORM?" }),
  summary({ id: 8, created_at: "2026-09-27T10:00:00Z", title: "Quando scadono le tasse?" }),
];

function sidebar(conversations: ConversationSummary[] | null) {
  return mount(
    <MemoryRouter>
      <SessionContext
        value={{
          account: { id: 1, username: "reader", locale: "it", is_superuser: false, roles: [] },
          logIn: async () => {},
          register: async () => {},
          logOut: async () => {},
          chooseLocale: async () => {},
          forget: () => {},
          recheck: async () => {},
        }}
      >
        <ConversationSidebar
          conversations={conversations}
          busy={null}
          onDelete={async () => true}
          controls={{
            placement: "column",
            onNavigate: () => {},
            onCollapse: () => {},
            onExpand: () => {},
            onClose: () => {},
            onSearch: () => {},
            searchRef: { current: null },
            onOpenSettings: () => {},
            onOpenHelp: () => {},
          }}
        />
      </SessionContext>
    </MemoryRouter>,
  );
}

function deleteButton(title: string) {
  const label = i18n.t("sidebar.delete", { title });
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.getAttribute("aria-label") === label,
  );
}

function search(container: HTMLElement, text: string) {
  const field = container.querySelector<HTMLInputElement>('input[type="search"]');
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    if (field === null) return;
    setter?.call(field, text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const rowTitles = (container: HTMLElement) =>
  [...container.querySelectorAll('a[href^="/c/"]')].map((row) => row.firstChild?.textContent);

describe("the conversation sidebar", () => {
  it("marks itself as the sidebar's panel, so the shell's keys work in the drawer", () => {
    // useShellShortcuts.ts holds the keys back in any dialog without this mark.
    const { container, unmount } = sidebar(ROWS);
    const marked = container.firstElementChild?.hasAttribute("data-sidebar-panel");
    unmount();

    expect(marked).toBe(true);
  });

  it("shows rows on their way while the list loads, never the empty panel", () => {
    const { container, unmount } = sidebar(null);
    const loading = container.querySelector('[role="status"]')?.getAttribute("aria-label");
    const text = container.textContent;
    unmount();

    expect(loading).toBe(i18n.t("sidebar.loading"));
    expect(text).not.toContain(i18n.t("sidebar.emptyTitle"));
  });

  it("shows the empty panel once the server has said there is nothing", () => {
    const { container, unmount } = sidebar([]);
    const text = container.textContent;
    const rows = rowTitles(container);
    unmount();

    expect(text).toContain(i18n.t("sidebar.emptyTitle"));
    expect(rows).toEqual([]);
  });

  it("counts the conversations, each with when it started", () => {
    const { container, unmount } = sidebar(ROWS);
    const heading = container.querySelector('nav[aria-label="Recenti"] h2')?.textContent;
    const times = [...container.querySelectorAll("a time")].map((time) =>
      time.getAttribute("datetime"),
    );
    unmount();

    expect(heading).toBe("Recenti2");
    expect(times).toEqual(ROWS.map((row) => row.created_at));
  });

  it("filters the titles as the search is typed, and says when nothing matches", () => {
    const { container, unmount } = sidebar(ROWS);

    search(container, "tasse");
    const found = rowTitles(container);
    search(container, "mensa");
    const none = rowTitles(container);
    const text = container.textContent;
    unmount();

    expect(found).toEqual(["Quando scadono le tasse?"]);
    expect(none).toEqual([]);
    expect(text).toContain(i18n.t("sidebar.noMatch"));
  });

  it("hands focus back to the delete button when the question is cancelled", async () => {
    const { unmount } = sidebar(ROWS);
    const trigger = deleteButton("Che cos'è un ORM?");
    act(() => {
      trigger?.focus();
      trigger?.click();
    });
    const cancel = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ].find((button) => button.textContent === i18n.t("sidebar.cancel"));
    act(() => cancel?.click());
    // Radix moves focus on closing in a task of its own.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const back = document.activeElement === trigger;
    unmount();

    expect(back).toBe(true);
  });
});
