import { expect, it } from "vitest";

import { render } from "@/test/render";
import { Button } from "./button";

it("carries the accent as its default variant", () => {
  // Not decoration: `bg-accent` is the single most visible consumer of the
  // accent token, so a change to that token shows up here first.
  expect(render(<Button>ok</Button>)).toContain("bg-accent");
});

it("waits for its own request with a spinner, off so it is not sent twice, in its colour", () => {
  const html = render(<Button pending>Assegnazione…</Button>);

  expect({
    off: html.includes("disabled"),
    busy: html.includes('aria-busy="true"'),
    spinner: html.includes("spinner"),
    unfaded: html.includes("disabled:opacity-100"),
  }).toEqual({ off: true, busy: true, spinner: true, unfaded: true });
});

it("shows its key on a cap screen readers skip, and names it as the shortcut", () => {
  const html = render(<Button shortcut={{ keys: "Enter", label: "Invio" }}>Assegna</Button>);

  expect(html).toContain('aria-keyshortcuts="Enter"');
  expect(html).toMatch(/<kbd aria-hidden="true"[^>]*>Invio<\/kbd>/);
});

it("keeps the caller's own busy state and key when it has no pending or shortcut of its own", () => {
  const html = render(
    <Button aria-busy aria-keyshortcuts="Control+K">
      Cerca
    </Button>,
  );

  expect(html).toContain('aria-busy="true"');
  expect(html).toContain('aria-keyshortcuts="Control+K"');
});
