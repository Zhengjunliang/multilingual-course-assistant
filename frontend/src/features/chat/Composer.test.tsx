// @vitest-environment jsdom

/**
 * What the composer's one button offers in each state, what its foot says,
 * and when its box travels.
 *
 * The send button is never turned off (DESIGN.md, Do's and Don'ts): with
 * nothing to send it is outlined rather than filled, and a press says what is
 * missing. How far the box travels needs a layout, which a document has not
 * got; the browser test in `e2e/demo.spec.ts` reads that, and these read only
 * whether it travels at all.
 */

import { act, useState } from "react";
import { describe, expect, it } from "vitest";

import { Composer } from "@/features/chat/Composer";
import type { Waiting } from "@/features/chat/useAsk";
import i18n from "@/i18n";
import { mount } from "@/test/mount";

interface Handlers {
  onSubmit?: (question: string) => void;
  onStop?: () => void;
}

function composer(waiting: Waiting = { phase: "idle" }, handlers: Handlers = {}) {
  return mount(
    <Composer
      waiting={waiting}
      onSubmit={handlers.onSubmit ?? (() => {})}
      onStop={handlers.onStop ?? (() => {})}
      placement="hero"
    />,
  );
}

function type(container: HTMLElement, text: string) {
  const field = container.querySelector("textarea");
  if (field === null) throw new Error("no textarea");
  // React listens through its own onChange, which rides on the native `input`
  // event; setting `.value` alone would update the DOM and tell React nothing.
  const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.bind(
    field,
  );
  act(() => {
    setter?.(text);
    field.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

const send = (container: HTMLElement) =>
  container.querySelector<HTMLButtonElement>("button[type='submit']");

describe("the composer", () => {
  it("keeps the send button on and outlined while there is nothing to send", () => {
    const { container, unmount } = composer();
    const button = send(container);
    const seen = {
      text: button?.textContent,
      disabled: button?.disabled,
      outlined: button?.className.includes("border-line"),
    };
    unmount();

    expect(seen).toEqual({ text: "Chiedi", disabled: false, outlined: true });
  });

  it("fills the send button with the first character", () => {
    const { container, unmount } = composer();

    type(container, "Quando inizia la sessione?");
    const filled = send(container)?.className.includes("bg-accent");
    unmount();

    expect(filled).toBe(true);
  });

  it.each([
    ["nothing", ""],
    ["only whitespace", "   "],
  ])(
    "pressed on %s, sends nothing, puts the caret in the field and says what is missing",
    (_, text) => {
      const sent: string[] = [];
      const { container, unmount } = composer({ phase: "idle" }, { onSubmit: (q) => sent.push(q) });

      type(container, text);
      act(() => send(container)?.click());
      const seen = {
        sent,
        focused: document.activeElement === container.querySelector("textarea"),
        said: container.querySelector('[role="status"]')?.textContent,
      };
      type(container, "Quando?");
      const after = container.querySelector('[role="status"]')?.textContent;
      unmount();

      expect(seen).toEqual({ sent: [], focused: true, said: "Scrivi prima la domanda." });
      expect(after).toBe("");
    },
  );

  it("lets go of what is missing once the field is left, so the next press says it again", () => {
    // A live region is heard when its words change: pressed twice with no
    // change between, the second press would say nothing.
    const { container, unmount } = composer();
    const said = () => container.querySelector('[role="status"]')?.textContent;

    act(() => send(container)?.click());
    const first = said();
    act(() => container.querySelector("textarea")?.blur());
    const left = said();
    act(() => send(container)?.click());
    const again = said();
    unmount();

    expect({ first, left, again }).toEqual({
      first: "Scrivi prima la domanda.",
      left: "",
      again: "Scrivi prima la domanda.",
    });
  });

  it("lets go of what is missing when the conversation changes under it", () => {
    // The key for a new conversation changes the page without leaving the field.
    let switchTo: (conversation: number | null) => void = () => {};
    function Switching() {
      const [conversation, setConversation] = useState<number | null>(7);
      switchTo = setConversation;
      return (
        <Composer
          waiting={{ phase: "idle" }}
          onSubmit={() => {}}
          onStop={() => {}}
          conversation={conversation}
        />
      );
    }
    const { container, unmount } = mount(<Switching />);
    const said = () => container.querySelector('[role="status"]')?.textContent;

    act(() => send(container)?.click());
    const pressed = said();
    act(() => switchTo(null));
    const moved = said();
    unmount();

    expect({ pressed, moved }).toEqual({ pressed: "Scrivi prima la domanda.", moved: "" });
  });

  it("puts a stop button with its word in its place while an answer is written, and it stops", () => {
    let stopped = 0;
    const { container, unmount } = composer(
      { phase: "streaming" },
      { onStop: () => (stopped += 1) },
    );
    const stop = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === i18n.t("ask.cancel"),
    );
    act(() => stop?.click());
    const seen = { send: send(container) !== null, stop: stop !== undefined, stopped };
    unmount();

    expect(seen).toEqual({ send: false, stop: true, stopped: 1 });
  });

  it("names the keys at its foot, and the answer being written while one is", () => {
    const foot = (waiting: Waiting) => {
      const { container, unmount } = composer(waiting);
      const text = container.querySelector("form p")?.textContent;
      unmount();
      return text;
    };

    expect(foot({ phase: "idle" })).toBe("Invioper chiedere·Maiusc Invioa capo");
    expect(foot({ phase: "streaming" })).toBe("Sto scrivendo la risposta…");
  });

  it("does not replay a travel it mounts with", () => {
    // The page keeps where its last first question started. A composer
    // mounted again later, after a conversation that could not be read, did
    // not make that travel and must not slide from there.
    const { container, unmount } = mount(
      <Composer
        waiting={{ phase: "idle" }}
        onSubmit={() => {}}
        onStop={() => {}}
        placement="hero"
        travelFrom={{ top: 100 }}
      />,
    );
    const travelling = container.querySelector(".travel") !== null;
    unmount();

    expect(travelling).toBe(false);
  });

  it("travels from a start it is given, and lets go of a travel cut short", () => {
    // The page's part, as ChatPage plays it when the entry has gone: a start
    // handed to a composer that is already there.
    function Page() {
      const [from, setFrom] = useState<{ top: number } | null>(null);
      return (
        <>
          <button type="button" data-start onClick={() => setFrom({ top: 100 })} />
          <Composer
            waiting={{ phase: "idle" }}
            onSubmit={() => {}}
            onStop={() => {}}
            travelFrom={from}
          />
        </>
      );
    }
    const { container, unmount } = mount(<Page />);

    act(() => container.querySelector<HTMLButtonElement>("[data-start]")?.click());
    const box = container.querySelector(".travel");
    act(() => {
      box?.dispatchEvent(Object.assign(new Event("animationcancel"), { animationName: "travel" }));
    });
    const seen = { started: box !== null, after: container.querySelector(".travel") !== null };
    unmount();

    expect(seen).toEqual({ started: true, after: false });
  });
});
