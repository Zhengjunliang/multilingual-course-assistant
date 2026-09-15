/**
 * The source strip: what it carries, and how it survives a narrow screen.
 *
 * The click that links a pill in the prose to its card is not here. A string
 * render has no events, and pretending otherwise would be worse than admitting
 * it — so the click is one of the two entries on the manual list in the pull
 * request. What *is* here is everything the click depends on: the marker is on
 * the card, the highlighted card is the one wearing the ring, and the strip is
 * still the horizontally scrolling row a phone needs it to be.
 */

import { describe, expect, it } from "vitest";

import type { Citation } from "@/api/contract";
import { badgesOf } from "@/lib/markers";
import { render } from "@/test/render";
import { CitationList } from "./CitationList";

function citation(marker: string, page: number): Citation {
  return {
    marker,
    kind: "slides",
    text: `Excerpt behind ${marker}.`,
    heading_path: [],
    course: "test",
    locale: "it",
    score: 0.5,
    source_file: "deck.pdf",
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

describe("the source strip", () => {
  it("carries each marker on its card, which is what a click aims at", () => {
    const html = strip();

    expect(html).toContain('data-marker="[Excerpt 1]"');
    expect(html).toContain('data-marker="[Excerpt 2]"');
  });

  it("rings the highlighted card and only that one", () => {
    const html = strip("[Excerpt 2]");
    const rings = [...html.matchAll(/ring-ink/g)];

    expect(rings).toHaveLength(1);
  });

  // These two stand in for a gate that cannot exist. The palette is achromatic,
  // so the link between a citation and its source is carried by fill rather
  // than by colour, and check-contrast.mjs has nothing left to measure about it:
  // it can prove --mark is a step away from the page, not that anything wears
  // it. That is what these assert.
  it("fills the highlighted card as well as ringing it", () => {
    expect(strip("[Excerpt 2]")).toContain("bg-mark ring-2 ring-ink");
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

  it("keeps the excerpt short until there is width for it", () => {
    // The card moved above the answer in this stage. Five lines of excerpt at
    // 390px would put the first line of the answer below the fold.
    const html = strip();

    expect(html).toContain("line-clamp-2");
    expect(html).toContain("lg:line-clamp-5");
  });
});
