// @vitest-environment jsdom

/**
 * The frame, asserted by using it.
 *
 * `routes/ChatPage.test.ts` says in its own header why it reads source instead
 * of rendering: the page wants a router and a session, and the drawer is a
 * portal a string render cannot see. The frame has neither problem — it takes
 * its sidebar and its controls as slots and holds nothing but a boolean — so
 * the two checks that used to be spellings of class names can be the real
 * question instead: does the button open the drawer, and does the drawer put
 * the sidebar on the page.
 *
 * The one claim that cannot be answered here is the breakpoint: `hidden
 * lg:block` is a media query, jsdom loads no stylesheet and computes no layout,
 * so nothing rendered would tell the two states apart. It also cannot be read
 * off the disk from *this* file — asking for a document costs
 * `import.meta.url`, which Vite's client transform turns into an http URL that
 * `fileURLToPath` refuses. It lives in `routes/ChatPage.test.ts`, which stayed
 * on the node environment for exactly that reason.
 */

import { act } from "react";
import { beforeEach, describe, expect, it } from "vitest";

import { ChatShell } from "@/features/chat/ChatShell";
import { mount } from "@/test/mount";

function shell() {
  return mount(
    <ChatShell
      sidebar={({ onNavigate, onCollapse }) => (
        <>
          <button type="button" onClick={onNavigate}>
            Che cos'è un ORM?
          </button>
          <button type="button" onClick={onCollapse}>
            Chiudi la barra laterale
          </button>
        </>
      )}
      controls={<span>Assistente del corso</span>}
    >
      <p>Cosa vuoi sapere?</p>
    </ChatShell>,
  );
}

function countSidebars() {
  return document.body.textContent?.match(/Che cos'è un ORM\?/g)?.length ?? 0;
}

function openButton(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>("header button");
}

/** The fake sidebar's second button, which is the one wired to `onCollapse`. */
function collapseButton(container: HTMLElement) {
  return container.querySelectorAll<HTMLButtonElement>("aside button")[1];
}

describe("the chat frame", () => {
  // The collapsed state outlives a component on purpose, so it has to be
  // cleared between cases or one of them decides what the next one sees.
  beforeEach(() => localStorage.clear());

  it("shows its controls and its children without opening anything", () => {
    const { container, unmount } = shell();

    expect(container.textContent).toContain("Assistente del corso");
    expect(container.textContent).toContain("Cosa vuoi sapere?");

    unmount();
  });

  it("opens the drawer when the sidebar button is pressed", () => {
    const { container, unmount } = shell();
    const button = openButton(container);

    expect(button).not.toBeNull();
    // The fixed column renders the sidebar too, so counting is what tells the
    // drawer apart from it: one copy closed, two open.
    expect(countSidebars()).toBe(1);

    act(() => button?.click());

    expect(countSidebars()).toBe(2);

    unmount();
  });

  it("closes the drawer when the reader navigates inside it", () => {
    const { container, unmount } = shell();

    act(() => openButton(container)?.click());
    expect(countSidebars()).toBe(2);

    // The drawer's own copy of the sidebar is the last one on the page.
    const inside = document.body.querySelectorAll<HTMLButtonElement>("button");
    act(() => inside[inside.length - 2]?.click());

    expect(countSidebars()).toBe(1);

    unmount();
  });

  it("closes the fixed column, and remembers that it is closed", () => {
    const first = shell();

    expect(countSidebars()).toBe(1);
    act(() => collapseButton(first.container)?.click());
    expect(countSidebars()).toBe(0);

    first.unmount();

    // A fresh mount, as if the page had been reloaded. The choice is about the
    // screen someone is sitting at, so it outlives the component.
    const second = shell();
    expect(countSidebars()).toBe(0);

    second.unmount();
  });

  it("brings the column back from the button that replaces it", () => {
    const { container, unmount } = shell();

    act(() => collapseButton(container)?.click());
    expect(countSidebars()).toBe(0);

    // With the column gone the header holds two buttons: the drawer's and this.
    const headerButtons = container.querySelectorAll<HTMLButtonElement>("header button");
    act(() => headerButtons[1]?.click());

    expect(countSidebars()).toBe(1);

    unmount();
  });
});
