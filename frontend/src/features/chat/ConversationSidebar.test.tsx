// @vitest-environment jsdom

/**
 * The sidebar's delete action, where the page cannot show it.
 *
 * Deleting through the dialog, and where the page goes afterwards, is asserted
 * on the whole application in routes/ChatPage.routing.test.tsx. What that test
 * cannot stage is an answer in progress: the one state in which a row must not
 * offer its delete, since the question would be refused and the half answer
 * lost. That takes a `busy` prop, so it is asserted here, beside where focus
 * goes when the question is cancelled.
 */

import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import type { ConversationSummary } from "@/api/conversations";
import i18n from "@/i18n";
import { mount } from "@/test/mount";
import { ConversationSidebar } from "./ConversationSidebar";

const ROWS: ConversationSummary[] = [
  { id: 7, locale: "it", created_at: "2026-09-28T10:00:00Z", title: "Che cos'è un ORM?" },
  { id: 8, locale: "it", created_at: "2026-09-27T10:00:00Z", title: "Quando scadono le tasse?" },
];

function deleteButton(title: string) {
  const label = i18n.t("sidebar.delete", { title });
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (button) => button.getAttribute("aria-label") === label,
  );
}

describe("the conversation sidebar", () => {
  it("offers no delete for a conversation whose answer is being written", () => {
    const { unmount } = mount(
      <MemoryRouter>
        <ConversationSidebar conversations={ROWS} busy={7} onDelete={async () => true} />
      </MemoryRouter>,
    );
    const busy = deleteButton("Che cos'è un ORM?");
    const idle = deleteButton("Quando scadono le tasse?");
    const disabled = [busy?.disabled, idle?.disabled];
    unmount();

    expect(disabled).toEqual([true, false]);
  });

  it("hands focus back to the delete button when the question is cancelled", async () => {
    const { unmount } = mount(
      <MemoryRouter>
        <ConversationSidebar conversations={ROWS} busy={null} onDelete={async () => true} />
      </MemoryRouter>,
    );
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
