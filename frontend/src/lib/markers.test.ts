import { describe, expect, it } from "vitest";
import type { Citation } from "@/api/contract";
import { badgesOf, resolveExcerptRefs, segmentAnswer } from "@/lib/markers";

/**
 * A citation with only the field these functions read spelled out.
 *
 * The other ten are required by the contract and read by nothing here, so they
 * are filled once rather than at every call: a fixture that restated all eleven
 * at each use would bury the one that matters.
 */
function cite(marker: string): Citation {
  return {
    marker,
    kind: "slides",
    text: "",
    heading_path: [],
    course: "PPM",
    locale: "en",
    score: 0,
    source_file: "deck.pdf",
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
  it("gives two citations of the same page one badge", () => {
    // The docstring's own case: two chunks of one page are two citations and
    // one thing the reader is being pointed at.
    expect(badgesOf([cite("[PPM 3]"), cite("[PPM 3]")])).toEqual([badge("[PPM 3]", 1)]);
  });

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

  it("leaves a number with no citation behind it as prose", () => {
    expect(resolveExcerptRefs("see Excerpt 9", citations)).toBe("see Excerpt 9");
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
    // One assertion for "loses nothing" and "repeats nothing" together.
    const answer = "Before [PPM 1] middle [WEB 2] after.";
    const badges = [badge("[PPM 1]", 1), badge("[WEB 2]", 2)];
    const rebuilt = segmentAnswer(answer, badges)
      .map((segment) => (segment.kind === "text" ? segment.text : segment.badge.marker))
      .join("");
    expect(rebuilt).toBe(answer);
  });

  it("returns the whole answer as one segment when no marker turns up", () => {
    expect(segmentAnswer("nothing cited here", [badge("[PPM 4]", 1)])).toEqual([
      { kind: "text", at: 0, text: "nothing cited here" },
    ]);
  });
});
