import { describe, expect, it } from "vitest";
import type { Citation } from "@/api/contract";
import {
  badgesOf,
  type MdNode,
  remarkPills,
  resolveExcerptRefs,
  segmentAnswer,
  withoutMarkers,
  withPills,
} from "@/lib/markers";

/**
 * A citation with only the field these functions read spelled out.
 *
 * The rest are required by the contract and read by nothing here, so they are
 * filled once rather than at every call: a fixture that restated every field
 * at each use would bury the one that matters.
 */
function cite(marker: string): Citation {
  return {
    marker,
    kind: "slides",
    text: "",
    heading_path: [],
    course: "PPM",
    academic_year: "2025-2026",
    locale: "en",
    score: 0,
    source_file: "deck.pdf",
    source_sha256: "ab".repeat(32),
    page: 1,
    url: null,
    fetch_date: null,
  };
}

/** A badge as `badgesOf` would have built it, for the segmentation tests. */
function badge(marker: string, number: number) {
  return { marker, number };
}

describe("badgesOf", () => {
  it("numbers distinct markers from one, in retrieval order", () => {
    expect(badgesOf([cite("[PPM 7]"), cite("[WEB 1]"), cite("[PPM 7]"), cite("[PPM 2]")])).toEqual([
      badge("[PPM 7]", 1),
      badge("[WEB 1]", 2),
      badge("[PPM 2]", 3),
    ]);
  });
});

describe("resolveExcerptRefs", () => {
  const citations = [cite("[PPM 1]"), cite("[PPM 2]"), cite("[WEB 9]")];

  it("rewrites every shape the model writes", () => {
    // Bracketed, parenthesised and bare are the three the docstring names.
    expect(resolveExcerptRefs("a [Excerpt 1] b (Excerpt 2) c Excerpt 3 d", citations)).toBe(
      "a [PPM 1] b [PPM 2] c [WEB 9] d",
    );
  });

  it("rewrites a list in one pair of brackets into markers side by side", () => {
    // As the model wrote them on 11 October 2026, in Italian, and the other
    // separators the docstring names.
    expect(
      [
        "a [Excerpt 1 e Excerpt 3].",
        "b [Excerpt 1, Excerpt 2, Excerpt 3].",
        "c (Excerpt 2 and 3)",
        "d [Excerpt 1、Excerpt 2]",
        "e （Excerpt 1，Excerpt 3）",
      ].map((answer) => resolveExcerptRefs(answer, citations)),
    ).toEqual([
      "a [PPM 1] [WEB 9].",
      "b [PPM 1] [PPM 2] [WEB 9].",
      "c [PPM 2] [WEB 9]",
      "d [PPM 1] [PPM 2]",
      "e [PPM 1] [WEB 9]",
    ]);
  });

  it("does not read a range as a list", () => {
    // "to" is not one of the conjunctions: each reference resolves alone, and
    // the range stays prose rather than dropping the excerpts inside it.
    expect(resolveExcerptRefs("(Excerpt 1 to 3)", citations)).toBe("([PPM 1] to 3)");
  });

  it("leaves a number with no citation behind it as prose", () => {
    expect(resolveExcerptRefs("see Excerpt 9", citations)).toBe("see Excerpt 9");
    // In a list, the references it can resolve still become markers.
    expect(resolveExcerptRefs("[Excerpt 1, Excerpt 9]", citations)).toBe("[[PPM 1], Excerpt 9]");
  });

  it("leaves Excerpt 0 as prose", () => {
    // The boundary below zero. With `+ 1`, or with the offset removed,
    // `Excerpt 0` resolves to a real citation and this goes red — as does the
    // three-shape test above, which is the honest way to put it: this case is
    // not the only guard on the offset, it is the one that names its floor.
    expect(resolveExcerptRefs("see Excerpt 0", citations)).toBe("see Excerpt 0");
  });
});

describe("segmentAnswer", () => {
  it("does not let a marker shadow the longer one it is a prefix of", () => {
    // The markers are constructed, not taken from a real citation, and that is
    // worth saying rather than hiding. `rag.answer.source_marker` closes every
    // marker with "]", so "[PPM 1]" cannot be a prefix of "[PPM 10]" — the "]"
    // and the "0" would have to be the same character. The docstring's own
    // example of the hazard therefore cannot arise from today's grammar, and a
    // test built on it would pass with the longest-first sort deleted.
    //
    // What the sort promises is still a promise about any badge list, so it is
    // tested with a pair that does nest. Remove the sort at markers.ts:80 and
    // this goes red: "[A]" is taken first and "[B]" is left stranded in prose.
    const badges = [badge("[A]", 1), badge("[A][B]", 2)];
    expect(segmentAnswer("See [A][B] now.", badges)).toEqual([
      { kind: "text", at: 0, text: "See " },
      { kind: "badge", at: 4, badge: badge("[A][B]", 2) },
      { kind: "text", at: 10, text: " now." },
    ]);
  });

  it("gives each occurrence of one marker its own offset", () => {
    // `at` is what React keys on, so two badges for the same marker must not
    // collide.
    expect(segmentAnswer("x [A] y [A] z", [badge("[A]", 1)])).toEqual([
      { kind: "text", at: 0, text: "x " },
      { kind: "badge", at: 2, badge: badge("[A]", 1) },
      { kind: "text", at: 5, text: " y " },
      { kind: "badge", at: 8, badge: badge("[A]", 1) },
      { kind: "text", at: 11, text: " z" },
    ]);
  });

  it("reassembles into the answer it was given", () => {
    // Loses nothing and repeats nothing, spelled out segment by segment: a
    // rebuilt string would stay equal with a wrong offset or a wrong badge, and
    // a failure here names the segment that broke.
    const badges = [badge("[PPM 1]", 1), badge("[WEB 2]", 2)];
    expect(segmentAnswer("Before [PPM 1] middle [WEB 2] after.", badges)).toEqual([
      { kind: "text", at: 0, text: "Before " },
      { kind: "badge", at: 7, badge: badge("[PPM 1]", 1) },
      { kind: "text", at: 14, text: " middle " },
      { kind: "badge", at: 22, badge: badge("[WEB 2]", 2) },
      { kind: "text", at: 29, text: " after." },
    ]);
  });

  it("returns the whole answer as one segment when no marker turns up", () => {
    expect(segmentAnswer("nothing cited here", [badge("[PPM 4]", 1)])).toEqual([
      { kind: "text", at: 0, text: "nothing cited here" },
    ]);
  });
});

describe("withoutMarkers", () => {
  it("drops each marker with the spaces that led up to it", () => {
    const badges = [badge("[PPM 1]", 1), badge("[WEB 2]", 2)];

    expect(
      withoutMarkers(
        "Le tasse scadono il 30 settembre [PPM 1] [WEB 2].\n- Prima rata [PPM 1]",
        badges,
      ),
    ).toBe("Le tasse scadono il 30 settembre.\n- Prima rata");
  });

  it("takes the space after a marker that opened a line, and ends where the text does", () => {
    const badges = [badge("[PPM 1]", 1), badge("[WEB 2]", 2)];

    expect(
      withoutMarkers("[PPM 1] e [WEB 2] non lo dicono.\n[WEB 2] Le tasse.  \n\n", badges),
    ).toBe("e non lo dicono.\nLe tasse.");
  });
});

describe("remarkPills", () => {
  /** The pills a paragraph of `answer` comes out with, as their `numbers`. */
  function pills(answer: string, badges: ReturnType<typeof badge>[]): (string | undefined)[] {
    const paragraph: MdNode = {
      type: "paragraph",
      children: [{ type: "text", value: withPills(answer, badges) }],
    };
    remarkPills(badges)({ type: "root", children: [paragraph] });
    return (paragraph.children ?? [])
      .filter((node) => node.type === "citationPill")
      .map((node) => node.data?.hProperties?.numbers);
  }

  const badges = [badge("[PPM 1]", 1), badge("[WEB 2]", 2), badge("[PPM 3]", 3)];

  it("draws pills side by side as one, each source once", () => {
    expect(pills("Scadono il 30 settembre [PPM 1] [WEB 2][PPM 1].", badges)).toEqual(["1,2"]);
  });

  it("keeps pills apart where words stand between them", () => {
    expect(pills("Prima [PPM 1], poi [PPM 3].", badges)).toEqual(["1", "3"]);
  });
});
