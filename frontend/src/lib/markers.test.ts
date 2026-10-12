import { describe, expect, it } from "vitest";
import type { Citation } from "@/api/contract";
import {
  citedMarkers,
  type MdNode,
  pillSources,
  remarkPills,
  segmentAnswer,
  withoutMarkers,
  withoutPills,
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

/**
 * The answer as `segmentAnswer` cuts it, each reference written as the excerpt
 * numbers it names: "a {1,3}." for a list of the first and third.
 */
function cut(answer: string, citations: readonly Citation[]): string {
  return segmentAnswer(answer, citations)
    .map((segment) => (segment.kind === "text" ? segment.text : `{${segment.excerpts.join(",")}}`))
    .join("");
}

describe("segmentAnswer, on excerpt numbers", () => {
  const citations = [cite("[PPM 1]"), cite("[PPM 2]"), cite("[WEB 9]")];

  it("reads every shape the model writes", () => {
    // Bracketed, parenthesised and bare are the three the docstring names.
    expect(cut("a [Excerpt 1] b (Excerpt 2) c Excerpt 3 d", citations)).toBe("a {1} b {2} c {3} d");
  });

  it("reads a list in one pair of brackets as one reference", () => {
    // As the model wrote them on 11 October 2026, in Italian, and the other
    // separators the docstring names.
    expect(
      [
        "a [Excerpt 1 e Excerpt 3].",
        "b [Excerpt 1, Excerpt 2, Excerpt 3].",
        "c (Excerpt 2 and 3)",
        "d [Excerpt 1、Excerpt 2]",
        "e （Excerpt 1，Excerpt 3）",
      ].map((answer) => cut(answer, citations)),
    ).toEqual(["a {1,3}.", "b {1,2,3}.", "c {2,3}", "d {1,2}", "e {1,3}"]);
  });

  it("does not read a range as a list", () => {
    // "to" is not one of the conjunctions: each reference resolves alone, and
    // the range stays prose rather than dropping the excerpts inside it.
    expect(cut("(Excerpt 1 to 3)", citations)).toBe("({1} to 3)");
  });

  it("leaves a number with no citation behind it as prose", () => {
    expect(cut("see Excerpt 9", citations)).toBe("see Excerpt 9");
    // In a list, the references it can resolve are still taken.
    expect(cut("[Excerpt 1, Excerpt 9]", citations)).toBe("[{1}, Excerpt 9]");
  });

  it("leaves Excerpt 0 as prose", () => {
    // The boundary below zero. With `+ 1`, or with the offset removed,
    // `Excerpt 0` resolves to a real citation and this goes red — as does the
    // three-shape test above, which is the honest way to put it: this case is
    // not the only guard on the offset, it is the one that names its floor.
    expect(cut("see Excerpt 0", citations)).toBe("see Excerpt 0");
  });

  it("names the excerpt it was given, not its page's first", () => {
    // #182: four excerpts of one page, and the answer cites the winter
    // sessions of two years as excerpts 3 and 4. A marker the model wrote
    // itself still names the page, at its best-ranked excerpt.
    const page = Array.from({ length: 4 }, () => cite("[WEB p537]"));
    expect(cut("2025-26: Excerpt 3. 2026-27: [Excerpt 4]. [WEB p537]", page)).toBe(
      "2025-26: {3}. 2026-27: {4}. {1}",
    );
  });

  it("leaves a marker whole when its own text holds an excerpt reference", () => {
    // The reference inside starts later than the marker that holds it.
    expect(cut("See [Notes Excerpt 1].", [cite("[PPM 1]"), cite("[Notes Excerpt 1]")])).toBe(
      "See {2}.",
    );
  });
});

describe("segmentAnswer, on markers", () => {
  it("does not let a marker shadow the longer one it is a prefix of", () => {
    // The markers are constructed, not taken from a real citation, and that is
    // worth saying rather than hiding. `rag.answer.source_marker` closes every
    // marker with "]", so "[PPM 1]" cannot be a prefix of "[PPM 10]" — the "]"
    // and the "0" would have to be the same character. The docstring's own
    // example of the hazard therefore cannot arise from today's grammar, and a
    // test built on it would pass with the tie-break deleted.
    //
    // What the tie-break promises is still a promise about any citation list,
    // so it is tested with a pair that does nest. Drop `b.end - a.end` from
    // `segmentAnswer`'s sort and this goes red: "[A]" is taken first and "[B]"
    // is left stranded in prose.
    expect(segmentAnswer("See [A][B] now.", [cite("[A]"), cite("[A][B]")])).toEqual([
      { kind: "text", at: 0, text: "See " },
      { kind: "reference", at: 4, excerpts: [2] },
      { kind: "text", at: 10, text: " now." },
    ]);
  });

  it("gives each occurrence of one marker its own offset", () => {
    // `withPills` reads the character before each reference off its `at`.
    expect(segmentAnswer("x [A] y [A] z", [cite("[A]")])).toEqual([
      { kind: "text", at: 0, text: "x " },
      { kind: "reference", at: 2, excerpts: [1] },
      { kind: "text", at: 5, text: " y " },
      { kind: "reference", at: 8, excerpts: [1] },
      { kind: "text", at: 11, text: " z" },
    ]);
  });

  it("reassembles into the answer it was given", () => {
    // Loses nothing and repeats nothing, spelled out segment by segment: a
    // rebuilt string would stay equal with a wrong offset or a wrong excerpt,
    // and a failure here names the segment that broke.
    const citations = [cite("[PPM 1]"), cite("[WEB 2]")];
    expect(segmentAnswer("Before [PPM 1] middle [WEB 2] after.", citations)).toEqual([
      { kind: "text", at: 0, text: "Before " },
      { kind: "reference", at: 7, excerpts: [1] },
      { kind: "text", at: 14, text: " middle " },
      { kind: "reference", at: 22, excerpts: [2] },
      { kind: "text", at: 29, text: " after." },
    ]);
  });

  it("returns the whole answer as one segment when no marker turns up", () => {
    expect(segmentAnswer("nothing cited here", [cite("[PPM 4]")])).toEqual([
      { kind: "text", at: 0, text: "nothing cited here" },
    ]);
  });
});

describe("citedMarkers", () => {
  it("counts a page cited by its marker or by one of its excerpts", () => {
    const citations = [cite("[A]"), cite("[A]"), cite("[B]"), cite("[C]")];
    expect(citedMarkers("Vedi Excerpt 2 e [B].", citations)).toEqual(new Set(["[A]", "[B]"]));
  });
});

describe("withoutMarkers", () => {
  const citations = [cite("[PPM 1]"), cite("[WEB 2]")];

  it("drops each reference with the spaces that led up to it", () => {
    expect(
      withoutMarkers(
        "Le tasse scadono il 30 settembre [PPM 1] [WEB 2].\n- Prima rata [PPM 1] (Excerpt 2)",
        citations,
      ),
    ).toBe("Le tasse scadono il 30 settembre.\n- Prima rata");
  });

  it("takes the space after a marker that opened a line, and ends where the text does", () => {
    expect(
      withoutMarkers("[PPM 1] e [WEB 2] non lo dicono.\n[WEB 2] Le tasse.  \n\n", citations),
    ).toBe("e non lo dicono.\nLe tasse.");
  });
});

describe("remarkPills", () => {
  /** The pills a paragraph of `answer` comes out with, as their `numbers`. */
  function pills(answer: string, citations: readonly Citation[]): (string | undefined)[] {
    const paragraph: MdNode = {
      type: "paragraph",
      children: [{ type: "text", value: withPills(answer, citations) }],
    };
    remarkPills(citations)({ type: "root", children: [paragraph] });
    return (paragraph.children ?? [])
      .filter((node) => node.type === "citationPill")
      .map((node) => node.data?.hProperties?.numbers);
  }

  const citations = [cite("[PPM 1]"), cite("[WEB 2]"), cite("[PPM 3]")];

  it("draws pills side by side as one, each excerpt once", () => {
    expect(pills("Scadono il 30 settembre [PPM 1] [WEB 2][PPM 1].", citations)).toEqual(["1,2"]);
  });

  it("keeps pills apart where words stand between them", () => {
    expect(pills("Prima [PPM 1], poi [PPM 3].", citations)).toEqual(["1", "3"]);
  });

  it("draws a list as one pill, and two excerpts of one page as two of its numbers", () => {
    expect(pills("Vedi [Excerpt 1 e Excerpt 3].", citations)).toEqual(["1,3"]);
    expect(pills("Vedi Excerpt 1 Excerpt 2.", [cite("[A]"), cite("[A]")])).toEqual(["1,2"]);
  });

  it("draws a marker and an excerpt number beside it as one pill, whatever space parts them", () => {
    // The prompt's header reads "Excerpt 3 [m]:", and the model copies the
    // pair either way round; `pillSources` then shows the numbered excerpt.
    const page = Array.from({ length: 4 }, () => cite("[W]"));
    expect(
      [
        "[W] (Excerpt 3).",
        "Excerpt 3 [W].",
        "[W]\nExcerpt 3.",
        "[W] (Excerpt 3).",
        "[W]　Excerpt 3。",
      ].map((answer) => pills(answer, page)),
    ).toEqual([["1,3"], ["3,1"], ["1,3"], ["1,3"], ["1,3"]]);
  });
});

describe("pillSources", () => {
  // Four excerpts of one page, then a page of its own.
  const citations = [...Array.from({ length: 4 }, () => cite("[W]")), cite("[N]")];
  /** The excerpts a pill drawn from `numbers` shows, by their numbers. */
  const shown = (numbers: number[]) =>
    pillSources(numbers, citations).map((citation) => citations.indexOf(citation) + 1);

  it("shows the excerpt a number names over the first one its page's marker stands for", () => {
    expect([shown([1, 3]), shown([3, 1]), shown([1])]).toEqual([[3], [3], [1]]);
  });

  it("shows each page once, in the order the pill names them, at the first number it names", () => {
    // "[W] [N] Excerpt 2": the marker of [W], the marker of [N], then [W]'s
    // second excerpt.
    expect([shown([1, 5, 2]), shown([4, 3])]).toEqual([[2, 5], [4]]);
  });

  it("leaves out a number with no excerpt behind it", () => {
    expect(shown([0, 9, 5])).toEqual([5]);
  });
});

describe("withoutPills", () => {
  it("writes a list back as its markers, a space between them", () => {
    // Where a pill cannot sit, in code or in an answer that cannot be parsed.
    const citations = [cite("[PPM 1]"), cite("[PPM 2]"), cite("[WEB 9]")];
    expect(withoutPills(withPills("Vedi (Excerpt 1, 3).", citations), citations)).toBe(
      "Vedi [PPM 1] [WEB 9].",
    );
  });
});
