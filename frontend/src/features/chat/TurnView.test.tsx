// @vitest-environment jsdom

/**
 * The process line says how the answer was searched, loudly enough to be
 * read, and the sources sit above the answer rather than under it.
 *
 * Both are assertions about the `start` event being spent rather than stored:
 * the route and the citations arrive together, before the first token, and the
 * point is to put that fact on the screen at the moment it is true.
 *
 * The document is for one case. How loud the process line is depends on which
 * element around it carries a type size, and a string render can only answer
 * that by naming the tag; a mounted turn answers it with `closest`.
 */

import { act, useState } from "react";
import { MemoryRouter } from "react-router-dom";
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
    searchMs: 2400,
    locale: "it",
    complete: true,
    failure: null,
    ...overrides,
  };
}

function view(t: Turn, live = false, thinking = false, visitor = false): string {
  // A router because a visitor's turn may link to the login page.
  return render(
    <MemoryRouter>
      <TurnView
        turn={t}
        live={live}
        thinking={thinking}
        highlighted={null}
        onHighlight={() => {}}
        visitor={visitor}
      />
    </MemoryRouter>,
  );
}

describe("the process line", () => {
  it("is one folded line, which names where the answer was searched once opened", () => {
    const html = view(turn());

    expect(html).toContain("<details");
    expect(html).toContain("Ricerca completata · 2 s");
    expect(html).toContain("Cercato in entrambe le fonti");
    // The count is the start event's citations: RouteDecision has no field
    // for it, and none had to be added.
    expect(html).toContain("Letti 3 estratti");
  });

  it("never shows the router's reason", () => {
    expect(view(turn())).not.toContain(ROUTE.reason);
  });

  it("counts the seconds while the server has not said where it looked", () => {
    const html = view(
      turn({ route: null, searchMs: null, citations: [], answer: "", complete: false }),
      false,
      true,
    );

    expect(html).toContain("Ricerca in corso · 1 s");
  });

  it("is not set in the smallest type on the page", () => {
    // The route line it replaces was once `text-muted text-xs`, the right
    // thing in the quietest voice available. Guarding the negative keeps a
    // later tidy-up from putting it back.
    const { container, unmount } = mount(
      <TurnView
        turn={turn()}
        live={false}
        thinking={false}
        highlighted={null}
        onHighlight={() => {}}
        visitor={false}
      />,
    );
    const line = container.querySelector("summary")?.closest(TYPE_SIZES);
    if (line == null) throw new Error("no type size is set around the process line");

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
    const html = view(turn({ answer: "", complete: false }), true);

    expect(html).toContain("Fonti");
    expect(html).toContain("Ricerca completata");
  });
});

describe("the answer's language", () => {
  it("is marked on the question and on the prose, which is set as reading text", () => {
    // A Chinese exchange in the Italian interface: `lang` is what gives it the
    // Chinese stack and leading in index.css, and what a screen reader
    // switches voice on.
    const { container, unmount } = mount(
      <TurnView
        turn={turn({
          question: "学费什么时候截止？",
          answer: "学费九月三十日截止。[Excerpt 1]",
          locale: "zh",
        })}
        live={false}
        thinking={false}
        highlighted={null}
        onHighlight={() => {}}
        visitor={false}
      />,
    );
    const prose = container.querySelector('div[lang="zh"]');
    const marked = [...container.querySelectorAll("[lang]")].map((element) =>
      element.getAttribute("lang"),
    );
    const classes = [...(prose?.classList ?? [])];
    const text = prose?.textContent;
    const question = container.querySelector("article > p")?.getAttribute("lang");
    unmount();

    expect(text).toContain("学费九月三十日截止");
    // The page's sans, which `lang` turns into the Chinese stack: no family of
    // its own on the prose (DESIGN.md, Typography).
    expect(classes).toContain("text-reading");
    expect(classes.some((name) => name.startsWith("font-serif"))).toBe(false);
    // The route line and the sources are the interface's and the excerpts' own
    // languages; only the question and the answer say "zh". Citation cards
    // carry their own.
    expect(question).toBe("zh");
    expect(marked.filter((lang) => lang === "zh")).toHaveLength(2);
  });
});

describe("the cat beside the answer", () => {
  const poseIn = (html: string) => /data-pose="(\w+)"/.exec(html)?.[1];

  it("thinks until the first word arrives", () => {
    expect(poseIn(view(turn({ answer: "", complete: false }), false, true))).toBe("thinking");
  });

  it("is just there once the answer is", () => {
    expect(poseIn(view(turn()))).toBe("avatar");
  });

  it("apologises for an answer that failed", () => {
    const failed = turn({ complete: false, failure: { kind: "incomplete" } });

    expect(poseIn(view(failed))).toBe("error");
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
      visitor={false}
    />
  );
}

describe("a badge in the answer", () => {
  it("rings the source of the pill a reader clicks, and keeps focus on the pill", () => {
    const { container, unmount } = mount(<Highlighting of={turn()} />);
    const pill = container.querySelector<HTMLButtonElement>('button[aria-label$="[Excerpt 1]"]');
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

describe("a visitor's turn routed to the slides", () => {
  const slides: RouteDecision = { ...ROUTE, target: "slides" };
  const refused = turn({
    route: slides,
    citations: [],
    answer: "Non ho trovato materiale del corso pertinente a questa domanda.",
  });

  it("says why nothing was found, and where to sign in", () => {
    const html = view(refused, false, false, true);

    expect(html).toContain("riservato a chi ha un account");
    expect(html).toContain('href="/login"');
  });

  it.each([
    ["a signed-in reader's", refused, false],
    ["a visitor's campus", turn({ route: { ...ROUTE, target: "unifi_web" } }), true],
  ])("is the only one that says so, not %s turn", (_, shown, visitor) => {
    expect(view(shown, false, false, visitor)).not.toContain("riservato a chi ha un account");
  });
});
