// @vitest-environment jsdom

/**
 * The frame, asserted by using it.
 *
 * The chat page wants a router and a session, and the drawer is a portal a
 * string render cannot see. The frame has neither problem — it takes its
 * sidebar and its rail as slots and holds nothing but which panel is open — so
 * the checks can be the real questions: does the button open the drawer, does
 * folding leave the rail, do the keys do what they say.
 *
 * The breakpoint is answered two ways. jsdom loads no stylesheet and computes
 * no media query, so whether the column is on screen is read off the classes
 * of the mounted `aside` (`hidden lg:block`, which survives the class string
 * being built with `cn(...)` or reordered); what Ctrl K does at each width is
 * asked of `matchMedia`, which the shell calls and these cases stand in for.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ChatShell } from "@/features/chat/ChatShell";
import { mount } from "@/test/mount";
import { ThemeProvider } from "@/theme/ThemeProvider";

function shell(onNewConversation: () => void = () => {}) {
  return mount(
    <ThemeProvider>
      <ChatShell
        sidebar={({ placement, onNavigate, onCollapse, searchRef, onOpenSettings }) => (
          <>
            <button type="button" onClick={onNavigate}>
              Che cos'è un ORM?
            </button>
            <button type="button" onClick={onCollapse}>
              Chiudi la barra laterale
            </button>
            <button type="button" onClick={onOpenSettings}>
              Impostazioni…
            </button>
            <input ref={searchRef} aria-label={`Cerca (${placement})`} />
          </>
        )}
        rail={({ onExpand, onSearch }) => (
          <>
            <button type="button" onClick={onExpand}>
              Apri la barra laterale
            </button>
            <button type="button" onClick={onSearch}>
              Cerca
            </button>
          </>
        )}
        onNewConversation={onNewConversation}
      >
        <p>Cosa vuoi sapere?</p>
      </ChatShell>
    </ThemeProvider>,
  );
}

function countSidebars() {
  return document.body.textContent?.match(/Che cos'è un ORM\?/g)?.length ?? 0;
}

function button(label: string, root: ParentNode = document.body) {
  return [...root.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent === label,
  );
}

function press(init: KeyboardEventInit) {
  act(() => {
    document.body.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, ...init }));
  });
}

/** The shell asks `matchMedia` whether the column exists; these cases answer. */
function atWidth(wide: boolean) {
  const listen = () => {};
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: wide,
        media: query,
        addEventListener: listen,
        removeEventListener: listen,
      }) as unknown as MediaQueryList,
  );
}

async function settle() {
  // Radix moves the focus, opening and closing, in a task of its own.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("the chat frame", () => {
  // The folded state outlives a component on purpose, so it has to be
  // cleared between cases or one of them decides what the next one sees.
  beforeEach(() => localStorage.clear());
  afterEach(() => vi.restoreAllMocks());

  it("shows its children without opening anything", () => {
    const { container, unmount } = shell();

    expect(container.textContent).toContain("Cosa vuoi sapere?");
    expect(document.body.querySelector('[role="dialog"]')).toBeNull();

    unmount();
  });

  it("hides the fixed column below the large breakpoint", () => {
    // On a phone the drawer is the sidebar; the column beside the thread would
    // leave the answer a strip of the screen.
    const { container, unmount } = shell();
    const classes = [...(container.querySelector("aside")?.classList ?? [])];
    // Unmounted before asserting: a failure here must not leave a sidebar on
    // the page for the cases below, which count them.
    unmount();

    expect(classes).toEqual(expect.arrayContaining(["hidden", "lg:block"]));
  });

  it("opens the drawer from the button above the page, and closes it on arrival", () => {
    const { container, unmount } = shell();
    // The fixed column renders the sidebar too, so counting is what tells the
    // drawer apart from it: one copy closed, two open.
    const before = countSidebars();
    act(() => container.querySelector<HTMLButtonElement>("header button")?.click());
    const open = countSidebars();
    const drawer = document.body.querySelector('[role="dialog"]');
    act(() => button("Che cos'è un ORM?", drawer ?? document.body)?.click());
    const after = countSidebars();
    unmount();

    expect([before, open, after]).toEqual([1, 2, 1]);
  });

  it("folds into the rail, remembers it, and unfolds from the rail", () => {
    const first = shell();
    act(() => button("Chiudi la barra laterale")?.click());
    const folded = [countSidebars(), Boolean(button("Apri la barra laterale"))];
    first.unmount();

    // A fresh mount, as if the page had been reloaded. The choice is about the
    // screen someone is sitting at, so it outlives the component.
    const second = shell();
    const reloaded = [countSidebars(), Boolean(button("Apri la barra laterale"))];
    act(() => button("Apri la barra laterale")?.click());
    const unfolded = countSidebars();
    second.unmount();

    expect([folded, reloaded, unfolded]).toEqual([[0, true], [0, true], 1]);
  });

  it("gives the focus back to what opened a dialog once it closes", async () => {
    // Opened from state, as the account menu and the keys open them, so Radix
    // has no trigger of its own to return the focus to.
    const { unmount } = shell();
    const opener = button("Impostazioni…");
    act(() => {
      opener?.focus();
      opener?.click();
    });
    const heading = document.body.querySelector('[role="dialog"] h2')?.textContent;
    act(() =>
      document.body
        .querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="Chiudi"]')
        ?.click(),
    );
    await settle();
    const back = document.activeElement === opener;
    unmount();

    expect(heading).toBe("Impostazioni");
    expect(back).toBe(true);
  });

  it("starts a conversation, and opens the settings and the shortcuts, from the keys", () => {
    const started = vi.fn();
    const { unmount } = shell(started);

    press({ key: "O", ctrlKey: true, shiftKey: true });
    press({ key: ",", ctrlKey: true });
    const settings = document.body.querySelector('[role="dialog"] h2')?.textContent;
    press({ key: "?" });
    const help = document.body.querySelector('[role="dialog"] h2')?.textContent;
    unmount();

    expect(started).toHaveBeenCalledOnce();
    expect([settings, help]).toEqual(["Impostazioni", "Aiuto e scorciatoie"]);
  });

  it("unfolds the rail for Ctrl K on a wide screen, and puts the focus in the search", () => {
    atWidth(true);
    const { unmount } = shell();
    act(() => button("Chiudi la barra laterale")?.click());

    press({ key: "k", ctrlKey: true });
    const focused = document.activeElement?.getAttribute("aria-label");
    const unfolded = countSidebars();
    unmount();

    expect([unfolded, focused]).toEqual([1, "Cerca (column)"]);
  });

  it("opens the drawer for Ctrl K on a phone, the focus in its search", async () => {
    atWidth(false);
    const { unmount } = shell();

    press({ key: "k", ctrlKey: true });
    await settle();
    const focused = document.activeElement?.getAttribute("aria-label");
    const drawer = Boolean(document.body.querySelector('[role="dialog"]'));
    unmount();

    expect([drawer, focused]).toEqual([true, "Cerca (drawer)"]);
  });
});
