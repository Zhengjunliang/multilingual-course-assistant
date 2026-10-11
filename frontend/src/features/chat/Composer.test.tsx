// @vitest-environment jsdom

/**
 * What the composer's one button offers in each state, and when its box
 * travels.
 *
 * A send button rendered disabled on the accent fill is a defect no gate
 * catches: `disabled:opacity-50` makes a faded slab, the loudest thing on an
 * otherwise empty screen, and the first thing a reader sees. Every gate stays
 * green, because it is a claim about what is on the page in a given state, and
 * only a document can answer that. How far the box travels needs a layout,
 * which a document has not got; the browser test in `e2e/demo.spec.ts` reads
 * that, and these read only whether it travels at all.
 */

import { act, useState } from "react";
import { describe, expect, it } from "vitest";

import { Composer } from "@/features/chat/Composer";
import type { Waiting } from "@/features/chat/useAsk";
import i18n from "@/i18n";
import { mount } from "@/test/mount";

function composer(waiting: Waiting = { phase: "idle" }) {
  return mount(
    <Composer waiting={waiting} onSubmit={() => {}} onStop={() => {}} placement="hero" />,
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
  it("keeps the send button quiet while there is nothing to send", () => {
    const { container, unmount } = composer();
    const button = send(container);
    const seen = { disabled: button?.disabled, faded: button?.className.includes("opacity-50") };
    unmount();

    expect(seen).toEqual({ disabled: true, faded: false });
  });

  it("enables the send button with the first character", () => {
    const { container, unmount } = composer();

    type(container, "Quando inizia la sessione?");
    const disabled = send(container)?.disabled;
    unmount();

    expect(disabled).toBe(false);
  });

  it("does not count whitespace as something to send", () => {
    const { container, unmount } = composer();

    type(container, "   ");
    const disabled = send(container)?.disabled;
    unmount();

    expect(disabled).toBe(true);
  });

  it("puts the stop button in its place while an answer is written", () => {
    const { container, unmount } = composer({ phase: "streaming" });
    const seen = {
      send: send(container) !== null,
      stop: container.querySelector(`button[aria-label="${i18n.t("ask.cancel")}"]`) !== null,
    };
    unmount();

    expect(seen).toEqual({ send: false, stop: true });
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
