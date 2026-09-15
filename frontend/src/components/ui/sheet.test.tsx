// @vitest-environment jsdom

/**
 * The drawer, asserted by opening it.
 *
 * This is the check `routes/ChatPage.test.ts` says in its own header it cannot
 * make: `Sheet` is a Radix portal aimed at `document.body`, and a string render
 * has no body to aim at, so the drawer's contents came back as an empty string
 * and the only thing that could be tested was whether the element was still
 * spelled in the source. With a document the question becomes the real one —
 * does what was handed to the drawer end up on the page when it opens.
 *
 * Look in `document.body`, not in the container: a portal renders outside the
 * tree it was declared in, which is the entire reason it needs a document.
 */

import { describe, expect, it } from "vitest";

import { Sheet } from "@/components/ui/sheet";
import { mount } from "@/test/mount";

function open(isOpen: boolean) {
  return mount(
    <Sheet open={isOpen} onOpenChange={() => {}} title="Le tue conversazioni">
      <p>Che cos'è un ORM?</p>
    </Sheet>,
  );
}

describe("the sidebar drawer", () => {
  it("keeps its contents out of the document while it is closed", () => {
    const { unmount } = open(false);

    expect(document.body.textContent).not.toContain("Che cos'è un ORM?");

    unmount();
  });

  it("puts its contents in the document when it opens", () => {
    const { unmount } = open(true);

    expect(document.body.textContent).toContain("Che cos'è un ORM?");

    unmount();
  });

  it("names itself for a reader who cannot see it", () => {
    // The title is `sr-only` and has no visible counterpart, so this is the
    // only place it can be checked at all.
    const { unmount } = open(true);
    const dialog = document.body.querySelector('[role="dialog"]');

    expect(dialog).not.toBeNull();
    expect(dialog?.getAttribute("aria-labelledby")).not.toBeNull();
    expect(document.body.textContent).toContain("Le tue conversazioni");

    unmount();
  });
});
