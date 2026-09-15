// @vitest-environment jsdom

/**
 * What the composer offers before anything has been typed.
 *
 * This exists because of a defect nothing caught: the send button used to be
 * rendered disabled, which on the old palette was a washed-out accent that
 * still read as a button. On an achromatic one the accent is pure black and
 * `disabled:opacity-50` turns it into a grey slab with unreadable lettering —
 * the loudest thing on an otherwise empty screen, and the first thing a reader
 * sees. Every gate was green: it is a claim about what is on the page in a
 * given state, and only a document can answer that.
 */

import { act } from "react";
import { describe, expect, it } from "vitest";

import { Composer } from "@/features/chat/Composer";
import { mount } from "@/test/mount";

function composer() {
  return mount(
    <Composer waiting={{ phase: "idle" }} onSubmit={() => {}} onStop={() => {}} placement="hero" />,
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

describe("the composer", () => {
  it("shows no send button while there is nothing to send", () => {
    const { container, unmount } = composer();

    expect(container.querySelector("button[type='submit']")).toBeNull();

    unmount();
  });

  it("brings the send button back with the first character", () => {
    const { container, unmount } = composer();

    type(container, "Quando inizia la sessione?");

    expect(container.querySelector("button[type='submit']")).not.toBeNull();

    unmount();
  });

  it("does not count whitespace as something to send", () => {
    const { container, unmount } = composer();

    type(container, "   ");

    expect(container.querySelector("button[type='submit']")).toBeNull();

    unmount();
  });
});
