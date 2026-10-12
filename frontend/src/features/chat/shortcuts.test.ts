// @vitest-environment jsdom

/** Which key press is which of the shell's shortcuts, and how each is written. */

import { describe, expect, it } from "vitest";

import { shortcutOf, shortcuts } from "./shortcuts";

function press(init: KeyboardEventInit, target: HTMLElement = document.body): KeyboardEvent {
  const event = new KeyboardEvent("keydown", { bubbles: true, ...init });
  Object.defineProperty(event, "target", { value: target });
  return event;
}

describe("the shell's shortcuts", () => {
  it.each<[string, KeyboardEventInit, ReturnType<typeof shortcutOf>]>([
    ["Ctrl Shift O", { key: "O", ctrlKey: true, shiftKey: true }, "newConversation"],
    ["Cmd Shift O", { key: "o", metaKey: true, shiftKey: true }, "newConversation"],
    ["Ctrl K", { key: "k", ctrlKey: true }, "search"],
    ["Ctrl ,", { key: ",", ctrlKey: true }, "settings"],
    ["? on the page", { key: "?", shiftKey: true }, "help"],
    ["Ctrl O, which is the browser's", { key: "o", ctrlKey: true }, null],
    ["Ctrl Shift K", { key: "K", ctrlKey: true, shiftKey: true }, null],
    ["Alt Ctrl K", { key: "k", ctrlKey: true, altKey: true }, null],
    ["K alone", { key: "k" }, null],
  ])("hear %s", (_, init, name) => {
    expect(shortcutOf(press(init))).toBe(name);
  });

  it("leave ? to a field, where it is part of a question", () => {
    const field = document.createElement("textarea");
    expect(shortcutOf(press({ key: "?" }, field))).toBeNull();
    expect(shortcutOf(press({ key: "k", ctrlKey: true }, field))).toBe("search");
  });

  it("write Ctrl on most keyboards and ⌘ on Apple's", () => {
    expect(shortcuts(false).search).toEqual({ keys: "Control+K", label: "Ctrl K" });
    expect(shortcuts(true).newConversation).toEqual({ keys: "Meta+Shift+O", label: "⌘ ⇧ O" });
  });
});
