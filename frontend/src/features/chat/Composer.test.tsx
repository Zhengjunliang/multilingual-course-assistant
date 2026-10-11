// @vitest-environment jsdom

/**
 * What the composer's one button offers in each state.
 *
 * A send button rendered disabled on the accent fill is a defect no gate
 * catches: `disabled:opacity-50` makes a faded slab, the loudest thing on an
 * otherwise empty screen, and the first thing a reader sees. Every gate stays
 * green, because it is a claim about what is on the page in a given state, and
 * only a document can answer that.
 */

import { act } from "react";
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
});
