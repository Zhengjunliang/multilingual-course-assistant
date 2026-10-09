// @vitest-environment jsdom

/**
 * The sidebar's delete action, where the page cannot show it: where focus
 * goes when the question is cancelled.
 *
 * Deleting through the dialog, and where the page goes afterwards, is asserted
 * on the whole application: in routes/ChatPage.routing.test.tsx, and with an
 * answer being written in routes/staff.routing.test.tsx.
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
