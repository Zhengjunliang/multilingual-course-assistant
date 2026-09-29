// @vitest-environment jsdom

/**
 * The confirmation, asserted by opening it: what it is to a screen reader,
 * where focus starts, and that it closes only once the action is done.
 */

import { act } from "react";
import { describe, expect, it, vi } from "vitest";

import { AlertDialog } from "@/components/ui/alert-dialog";
import { mount } from "@/test/mount";

function open(onConfirm: () => Promise<boolean>, onOpenChange = vi.fn()) {
  const mounted = mount(
    <AlertDialog
      open
      onOpenChange={onOpenChange}
      title="Rimuovere mrossi?" // spellchecker:disable-line
      description="mrossi non insegnerà più B028451 2025-2026." // spellchecker:disable-line
      cancelLabel="Annulla"
      confirmLabel="Rimuovi"
      onConfirm={onConfirm}
      destructive
    >
      <p>refused</p>
    </AlertDialog>,
  );
  const dialog = document.body.querySelector<HTMLElement>('[role="alertdialog"]');
  const button = (name: string) =>
    [...(dialog?.querySelectorAll<HTMLButtonElement>("button") ?? [])].find(
      (b) => b.textContent === name,
    );
  return { ...mounted, dialog, button, onOpenChange };
}

describe("the alert dialog", () => {
  it("is an alertdialog described by its sentence, with focus on Cancel", () => {
    const { dialog, button, unmount } = open(async () => true);
    const described = document.getElementById(dialog?.getAttribute("aria-describedby") ?? "");
    const focused = document.activeElement === button("Annulla");
    unmount();

    expect(described?.textContent).toBe("mrossi non insegnerà più B028451 2025-2026."); // spellchecker:disable-line
    expect(focused).toBe(true);
  });

  it.each([
    ["closes once the action is done", true, [[false]]],
    ["stays open on a refusal, which it shows", false, []],
  ])("%s", async (_, done, closes) => {
    const { button, onOpenChange, unmount } = open(async () => done);

    await act(async () => button("Rimuovi")?.click());
    const shown = document.body.textContent?.includes("refused");
    unmount();

    expect(onOpenChange.mock.calls).toEqual(closes);
    expect(shown).toBe(true);
  });

  it("cannot be dismissed while the action runs", async () => {
    let finish: (done: boolean) => void = () => {};
    const { dialog, button, onOpenChange, unmount } = open(
      () => new Promise<boolean>((resolve) => (finish = resolve)),
    );

    await act(async () => button("Rimuovi")?.click());
    act(() => {
      dialog?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    const whileRunning = [...onOpenChange.mock.calls];
    const disabled = [button("Annulla")?.disabled, button("Rimuovi")?.disabled];
    await act(async () => finish(false));
    unmount();

    expect(whileRunning).toEqual([]);
    expect(disabled).toEqual([true, true]);
  });
});
