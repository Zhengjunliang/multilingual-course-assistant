// @vitest-environment jsdom

/**
 * The sidebar's states and its delete action, where the page cannot show
 * them: rows on their way, no conversations at all, a search that finds
 * nothing, where focus goes when a deletion is cancelled, and what a refused
 * one says.
 *
 * Deleting through the dialog, and where the page goes afterwards, is asserted
 * on the whole application: in routes/ChatPage.routing.test.tsx, and with an
 * answer being written in routes/staff.routing.test.tsx.
 */

import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { ConversationSummary } from "@/api/conversations";
import { ApiError } from "@/api/http";
import { SessionContext } from "@/auth/SessionProvider";
import i18n from "@/i18n";
import { describeError, type ErrorText } from "@/lib/errorText";
import { summary, uuidOf } from "@/test/conversations";
import { mount } from "@/test/mount";
import { ConversationSidebar } from "./ConversationSidebar";

const ORM = summary({
  id: uuidOf(7),
  created_at: "2026-09-28T10:00:00Z",
  title: "Che cos'è un ORM?",
});
const FEES = summary({
  id: uuidOf(8),
  created_at: "2026-09-27T10:00:00Z",
  title: "Quando scadono le tasse?",
});
const ROWS: ConversationSummary[] = [ORM, FEES];

function sidebar(
  conversations: ConversationSummary[] | null,
  onDelete: (id: string) => Promise<ErrorText | null> = async () => null,
) {
  return mount(
    <MemoryRouter>
      <SessionContext
        value={{
          account: {
            id: 1,
            username: "reader",
            locale: "it",
            is_superuser: false,
            roles: [],
            programme: null,
            year_of_study: null,
          },
          logIn: async () => {},
          register: async () => {},
          logOut: async () => {},
          chooseLocale: async () => {},
          chooseStudies: async () => {},
          forget: () => {},
          recheck: async () => {},
        }}
      >
        <ConversationSidebar
          conversations={conversations}
          busy={null}
          onPin={async () => true}
          onDelete={onDelete}
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

function labelled(label: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.getAttribute("aria-label") === label,
  );
}

const deleteButton = (title: string) => labelled(i18n.t("sidebar.delete", { title }));

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
  [...container.querySelectorAll('a[href^="/chat/"]')].map((row) => row.firstChild?.textContent);

const groupTitles = (container: HTMLElement, group: string) =>
  [...container.querySelectorAll(`nav[aria-label="${group}"] a`)].map(
    (row) => row.firstChild?.textContent,
  );

/** The row's second line: what its last answer drew on. */
const sourceLine = (container: HTMLElement, id: number) =>
  container.querySelector(`a[href="/chat/${uuidOf(id)}"]`)?.lastElementChild;

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

  it("counts the conversations, each with the time of its last message", () => {
    const { container, unmount } = sidebar(ROWS);
    const heading = container.querySelector('nav[aria-label="Recenti"] h2')?.textContent;
    const times = [...container.querySelectorAll("a time")].map((time) =>
      time.getAttribute("datetime"),
    );
    unmount();

    expect(heading).toBe("Recenti2");
    expect(times).toEqual(ROWS.map((row) => row.last_message_at));
  });

  it("puts the pinned conversations under «Fissate», counted, above the rest", () => {
    const pinned = [{ ...FEES, pinned: true }, ORM];
    const { container, unmount } = sidebar(pinned);
    const headings = [...container.querySelectorAll("nav h2")].map((h2) => h2.textContent);
    const fixed = groupTitles(container, "Fissate");
    const recent = groupTitles(container, "Recenti");
    unmount();
    const { container: none, unmount: unmountNone } = sidebar(ROWS);
    const noGroup = none.querySelector('nav[aria-label="Fissate"]');
    unmountNone();

    expect(headings).toEqual(["Fissate1", "Recenti1"]);
    expect(fixed).toEqual(["Quando scadono le tasse?"]);
    expect(recent).toEqual(["Che cos'è un ORM?"]);
    expect(noGroup).toBeNull();
  });

  it("names what each last answer drew on: the first course and how many more, the university, or nothing", () => {
    const course = (name: string) => ({ name, locale: "it" });
    const { container, unmount } = sidebar([
      summary({
        id: uuidOf(1),
        title: "a",
        last_source: {
          courses: [course("BASI DI DATI"), course("RETI LOGICHE"), course("CALCOLATORI")],
          web: true,
        },
      }),
      summary({ id: uuidOf(2), title: "b", last_source: { courses: [], web: true } }),
      summary({ id: uuidOf(3), title: "c", last_source: null }),
    ]);
    const both = sourceLine(container, 1);
    const lines = [
      both?.textContent,
      both?.querySelector('[aria-hidden="true"]:not(svg)')?.textContent,
      sourceLine(container, 2)?.textContent,
      sourceLine(container, 3)?.textContent,
    ];
    unmount();

    expect(lines).toEqual([
      "BASI DI DATI+2 e altri 2 corsiAteneo",
      "+2",
      "Ateneo",
      i18n.t("sidebar.noSource"),
    ]);
  });

  it("gives a title its first question's language and a course name its own", () => {
    const { container, unmount } = sidebar([
      summary({
        id: uuidOf(1),
        title: "考试报名截止日期",
        title_locale: "zh",
        last_source: { courses: [{ name: "PPM", locale: null }], web: false },
      }),
      summary({
        id: uuidOf(2),
        title: "",
        last_source: { courses: [{ name: "BASI DI DATI", locale: "it" }], web: false },
      }),
    ]);
    const langs = [1, 2].map((id) => {
      const row = container.querySelector(`a[href="/chat/${uuidOf(id)}"]`);
      return [
        row?.firstElementChild?.getAttribute("lang"),
        row?.querySelector("[lang]:not(:first-child)")?.getAttribute("lang") ?? null,
      ];
    });
    unmount();

    // An untitled row says so in the interface's words, which carry no `lang`.
    expect(langs).toEqual([
      ["zh", null],
      [null, "it"],
    ]);
  });

  it("names the pin button by what it will do", () => {
    const { unmount } = sidebar([{ ...ORM, pinned: true }, FEES]);
    const names = [
      i18n.t("sidebar.unpin", { title: "Che cos'è un ORM?" }),
      i18n.t("sidebar.pin", { title: "Quando scadono le tasse?" }),
    ].map((label) => labelled(label) !== undefined);
    unmount();

    expect(names).toEqual([true, true]);
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

  it.each([
    [
      "a refusal the reader can act on, by its reason alone",
      new ApiError({ status: 403, code: "PERMISSION_DENIED" }),
      `${i18n.t("sidebar.deleteFailed")} ${i18n.t("errors.PERMISSION_DENIED")}`,
    ],
    [
      "a failure to report, with its code",
      new TypeError("Failed to fetch"),
      `${i18n.t("sidebar.deleteFailed")} ${i18n.t("errors.NETWORK")}NETWORK`,
    ],
  ])("says what failed and then why, for %s", async (_, error, said) => {
    const { unmount } = sidebar(ROWS, async () => describeError(error));
    act(() => deleteButton("Che cos'è un ORM?")?.click());
    const confirm = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ].find((button) => button.textContent === i18n.t("sidebar.deleteConfirm"));
    await act(async () => confirm?.click());
    const text = document.body.querySelector('[role="alertdialog"] [role="alert"]')?.textContent;
    unmount();

    expect(text).toBe(said);
  });
});
