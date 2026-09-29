// @vitest-environment jsdom

/**
 * The route line says where the answer came from, loudly enough to be read, and
 * the sources sit above the answer rather than under it.
 *
 * Both are assertions about the `start` event being spent rather than stored:
 * the route and the citations arrive together, before the first token, and the
 * point of this stage was to put that fact on the screen at the moment it is
 * true.
 *
 * The document is for one case. How loud the route line is depends on which
 * element around it carries a type size, and a string render can only answer
 * that by naming the tag; a mounted turn answers it with `closest`.
 */

import { act, useState } from "react";
import { describe, expect, it } from "vitest";

import type { Citation, RouteDecision } from "@/api/contract";
import { mount } from "@/test/mount";
import { render } from "@/test/render";
import { TurnView } from "./TurnView";
import type { Turn } from "./useAsk";

/** The type-size tokens of index.css, smallest first. */
const TYPE_SIZES = ".text-caption, .text-body, .text-title, .text-display";

function citation(marker: string, page: number): Citation {
  return {
    marker,
    kind: "slides",
    text: `Excerpt behind ${marker}.`,
    heading_path: [],
    course: "test",
    academic_year: "2025-2026",
    locale: "it",
    score: 0.5,
    source_file: "deck.pdf",
    source_sha256: "ab".repeat(32),
    page,
    url: null,
    fetch_date: null,
  };
}

const ROUTE: RouteDecision = {
  target: "both",
  query: "scadenze",
  fresh: false,
  reason: "La domanda tocca il corso e l'ateneo.",
};

function turn(overrides: Partial<Turn> = {}): Turn {
  return {
    key: "t1",
    question: "Quando scadono le tasse?",
    answer: "La scadenza è il 30 settembre. [Excerpt 1]",
    citations: [citation("[Excerpt 1]", 3), citation("[Excerpt 2]", 4), citation("[Excerpt 3]", 5)],
    route: ROUTE,
    complete: true,
    failure: null,
    ...overrides,
  };
}

function view(t: Turn, live = false, thinking = false): string {
  return render(
    <TurnView turn={t} live={live} thinking={thinking} highlighted={null} onHighlight={() => {}} />,
  );
}

describe("the route line", () => {
  it("names where the answer was searched", () => {
    expect(view(turn())).toContain("entrambe le fonti");
  });

  it("counts the excerpts it was given", () => {
    // The count is not in RouteDecision — its four fields are target, query,
    // fresh and reason. It comes from the citations of the same start event,
    // which is why no field had to be added to the contract for this.
    expect(view(turn())).toContain("3 estratti");
  });

  it("is already there before the first token", () => {
    const html = view(turn({ answer: "", complete: false }), false, true);

    expect(html).toContain("entrambe le fonti");
    expect(html).toContain("3 estratti");
  });

  it("is not set in the smallest type on the page", () => {
    // It used to be `text-muted text-xs`, which said the right thing in the
    // quietest voice available. Guarding the negative is the only way to keep a
    // later tidy-up from putting it back.
    const { container, unmount } = mount(
      <TurnView
        turn={turn()}
        live={false}
        thinking={false}
        highlighted={null}
        onHighlight={() => {}}
      />,
    );
    // The deepest element holding the route name comes last in document order;
    // the nearest one around it with a type size is the line, whatever its tag.
    const name = [...container.querySelectorAll("*")]
      .filter((element) => element.textContent?.includes("entrambe le fonti"))
      .at(-1);
    const line = name?.closest(TYPE_SIZES);
    if (line == null) throw new Error("no type size is set around the route line");

    expect([...line.classList]).toContain("text-body");
    expect([...line.classList]).not.toContain("text-caption");

    unmount();
  });
});

describe("the order of a turn", () => {
  it("puts the sources above the answer", () => {
    const html = view(turn());
    const sources = html.indexOf("Fonti");
    const answer = html.indexOf("La scadenza");

    expect(sources).toBeGreaterThan(-1);
    expect(answer).toBeGreaterThan(-1);
    expect(sources).toBeLessThan(answer);
  });

  it("shows the sources while the answer is still being written", () => {
    const html = view(turn({ answer: "", complete: false }), false, true);

    expect(html).toContain("Fonti");
    expect(html).toContain("Sto cercando");
  });
});

/** The page's wiring of the highlight (ChatPage.tsx), around one turn. */
function Highlighting({ of }: { of: Turn }) {
  const [highlighted, setHighlighted] = useState<string | null>(null);
  return (
    <TurnView
      turn={of}
      live={false}
      thinking={false}
      highlighted={highlighted}
      onHighlight={setHighlighted}
    />
  );
}

describe("a badge in the answer", () => {
  it("rings the source of the pill a reader clicks, and keeps focus on the pill", () => {
    const { container, unmount } = mount(<Highlighting of={turn()} />);
    const pill = container.querySelector<HTMLButtonElement>('button[title="[Excerpt 1]"]');
    if (pill === null) throw new Error("the answer has no badge for [Excerpt 1]");

    act(() => {
      pill.focus();
      pill.click();
    });
    const card = container.querySelector('[data-marker="[Excerpt 1]"] > *');
    // The same element, not merely a focused one: a badge rebuilt by the
    // re-render would leave focus on the body.
    const focused = document.activeElement;
    unmount();

    expect(card?.className).toContain("ring-ink");
    expect(focused).toBe(pill);
  });
});
