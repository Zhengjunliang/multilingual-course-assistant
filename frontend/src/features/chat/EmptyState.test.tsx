/**
 * The front door has something on it.
 *
 * The check that matters is not "a heading exists" but "a reader who knows
 * nothing about this system is offered both of its knowledge bases before they
 * type". That is why the chips are asserted by count and by language rather
 * than by their exact wording, which will change.
 */

import { describe, expect, it } from "vitest";

import { render } from "@/test/render";
import { EmptyState } from "./EmptyState";

const html = (): string => render(<EmptyState onPick={() => {}} />);

describe("the empty state", () => {
  it("asks the reader a question instead of describing itself", () => {
    expect(html()).toContain("Cosa vuoi sapere?");
  });

  it("offers three things to ask", () => {
    // Fewer than three and one knowledge base goes unrepresented; the two
    // university chips and the course one are the point of the row.
    const chips = [...html().matchAll(/<button[^>]*type="button"/g)];

    expect(chips).toHaveLength(3);
  });

  it("covers both knowledge bases in what it offers", () => {
    const rendered = html();

    // One question only the university pages can answer…
    expect(rendered).toContain("iscrizione");
    // …and one only the slides can.
    expect(rendered).toContain("lezione del corso");
  });

  it("offers them in a row that scrolls rather than wrapping", () => {
    // Wrapped onto a second line at 390px, the chips push the composer below
    // the fold and the front door stops looking like one.
    expect(html()).toContain("overflow-x-auto");
  });

  it("renders without a router or a session", () => {
    // The reason it is its own component: ChatPage needs both, and standing
    // them up to look at a heading is how a test stops being run.
    expect(() => html()).not.toThrow();
  });
});
