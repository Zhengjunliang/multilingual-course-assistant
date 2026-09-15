// @vitest-environment jsdom

/**
 * The centred window, asserted by opening it.
 *
 * Like the drawer, its contents live in a portal on `document.body`, so a
 * string render returns nothing at all and the assertions have to look outside
 * the container they mounted into.
 */

import { describe, expect, it } from "vitest";

import { Dialog } from "@/components/ui/dialog";
import { mount } from "@/test/mount";

function open(isOpen: boolean) {
  return mount(
    <Dialog
      open={isOpen}
      onOpenChange={() => {}}
      title="Account"
      description="Gestisci le tue preferenze."
      closeLabel="Chiudi"
    >
      <p>Junliang Zheng</p>
    </Dialog>,
  );
}

describe("the dialog", () => {
  it("stays out of the document while it is closed", () => {
    const { unmount } = open(false);

    expect(document.body.textContent).not.toContain("Junliang Zheng");

    unmount();
  });

  it("shows its title, its description and its children when open", () => {
    const { unmount } = open(true);

    expect(document.body.textContent).toContain("Account");
    expect(document.body.textContent).toContain("Gestisci le tue preferenze.");
    expect(document.body.textContent).toContain("Junliang Zheng");

    unmount();
  });

  it("gives the close button a name, since it is only a cross", () => {
    const { unmount } = open(true);
    const close = document.body.querySelector('[aria-label="Chiudi"]');

    expect(close).not.toBeNull();

    unmount();
  });
});
