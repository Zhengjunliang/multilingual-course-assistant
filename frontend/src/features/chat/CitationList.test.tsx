// @vitest-environment jsdom

/**
 * The source strip: what it carries, and how it survives a narrow screen.
 *
 * The click on a pill in the prose belongs to AnswerStream and reaches this
 * component as `highlighted`. What this file checks is what the strip does with
 * it: the highlighted card is the one wearing the ring and the fill, and a card
 * folded behind the "more" button is unfolded rather than left out of reach.
 * Both read a mounted strip, the second because only a document runs the
 * strip's effect; the rest are markup and read a string render.
 */

import { describe, expect, it } from "vitest";

import type { Citation } from "@/api/contract";
import { badgesOf } from "@/lib/markers";
import { mount } from "@/test/mount";
import { render } from "@/test/render";
import { CitationList } from "./CitationList";

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

const CITATIONS = [citation("[Excerpt 1]", 3), citation("[Excerpt 2]", 4)];
const BADGES = badgesOf(CITATIONS);

function strip(highlighted: string | null = null): string {
  return render(
    <CitationList
      citations={CITATIONS}
      badges={BADGES}
      cited={new Set(["[Excerpt 1]"])}
      highlighted={highlighted}
      onSelect={() => {}}
    />,
  );
}

function mounted(citations: readonly Citation[], highlighted: string | null) {
  return mount(
    <CitationList
      citations={citations}
      badges={badgesOf(citations)}
      cited={null}
      highlighted={highlighted}
      onSelect={() => {}}
    />,
  );
}

/**
 * The classes of the card showing `excerpt`, and only the card's own: the badge
 * inside every card is filled with `bg-mark` too.
 */
function cardClasses(container: HTMLElement, excerpt: string): string[] {
  const item = [...container.querySelectorAll("li")].find((li) =>
    li.textContent?.includes(excerpt),
  );
  const card = item?.firstElementChild;
  if (card == null) throw new Error(`no card shows "${excerpt}"`);
  return [...card.classList];
}

describe("the source strip", () => {
  it("unfolds when the highlighted card is behind the fold", () => {
    // A `both` route can carry more excerpts than the strip shows; clicking the
    // pill of a folded one must still land on its card.
    const seven = Array.from({ length: 7 }, (_, i) => citation(`[Excerpt ${i + 1}]`, i + 1));

    const folded = mounted(seven, null);
    expect(folded.container.textContent).not.toContain("Excerpt behind [Excerpt 7].");
    folded.unmount();

    const { container, unmount } = mounted(seven, "[Excerpt 7]");
    expect(container.textContent).toContain("Excerpt behind [Excerpt 7].");
    unmount();
  });

  // These two stand in for a gate that cannot exist. The palette is achromatic,
  // so the link between a citation and its source is carried by fill rather
  // than by colour, and check-contrast.mjs has nothing left to measure about it:
  // it can prove --mark is a step away from the page, not that anything wears
  // it. That is what these assert.
  it("fills and rings the highlighted card, and no other", () => {
    const { container, unmount } = mounted(CITATIONS, "[Excerpt 2]");
    const highlighted = cardClasses(container, "Excerpt behind [Excerpt 2].");
    const other = cardClasses(container, "Excerpt behind [Excerpt 1].");

    expect(highlighted).toContain("bg-mark");
    expect(highlighted).toContain("ring-ink");
    expect(other).not.toContain("bg-mark");
    expect(other).not.toContain("ring-ink");

    unmount();
  });

  it("fills the badge that opens a source", () => {
    expect(strip()).toContain("bg-mark");
  });

  it("greys a source the answer retrieved but never cited", () => {
    // Not a style choice: retrieved-and-not-cited is exactly the case the error
    // taxonomy wants visible, and it is the second excerpt here.
    expect(strip()).toContain("opacity-50");
  });

  it("stays a row that scrolls sideways", () => {
    // The phone half of the responsive criterion. Stacked, two cards would push
    // the answer off the bottom of the screen; wrapped, they would do the same
    // more slowly.
    const html = strip();

    expect(html).toContain("overflow-x-auto");
    expect(html).toContain("shrink-0");
  });

  it.each(["slides", "web", "legacy"])(
    "offers the PDF page and the edition of a %s card only when it has them",
    (shape) => {
      const slides = { ...citation("[deck.pdf p.3]", 3), course: "B028451" };
      const card: Citation =
        shape === "slides"
          ? slides
          : shape === "web"
            ? {
                ...slides,
                kind: "web",
                source_sha256: null,
                academic_year: null,
                url: "https://www.unifi.it/p602.html",
                fetch_date: "2026-09-20",
              }
            : // Stored before the fields existed: missing, not null.
              (Object.fromEntries(
                Object.entries(slides).filter(
                  ([field]) => field !== "source_sha256" && field !== "academic_year",
                ),
              ) as unknown as Citation);
      const html = render(
        <CitationList
          citations={[card]}
          badges={badgesOf([card])}
          cited={null}
          highlighted={null}
          onSelect={() => {}}
        />,
      );
      const link = `href="/api/sources/${"ab".repeat(32)}#page=3"`;

      expect(html.includes(link)).toBe(shape === "slides");
      expect(html.includes("B028451 · 2025-2026")).toBe(shape === "slides");
      if (shape === "slides") expect(html).toContain('target="_blank"');
    },
  );

  it("keeps the excerpt short until there is width for it", () => {
    // The card moved above the answer in this stage. Five lines of excerpt at
    // 390px would put the first line of the answer below the fold.
    const html = strip();

    expect(html).toContain("line-clamp-2");
    expect(html).toContain("lg:line-clamp-5");
  });
});
