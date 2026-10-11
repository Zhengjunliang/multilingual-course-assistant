import { describe, expect, it } from "vitest";

import type { Citation } from "@/api/contract";
import i18n from "@/i18n";
import { hostOf, shortName, sourcesOf, titleOf } from "./sourceLabel";

const t = i18n.getFixedT("it");

function web(url: string, heading_path: string[] = []): Citation {
  return {
    marker: `[${url} · 2026-09-20]`,
    kind: "web",
    text: "Le iscrizioni si chiudono il 30 settembre.",
    heading_path,
    course: "",
    academic_year: null,
    locale: "it",
    score: 0.5,
    source_file: "",
    source_sha256: null,
    page: 1,
    url,
    fetch_date: "2026-09-20",
  };
}

function slide(page: number, heading_path: string[] = []): Citation {
  return {
    ...web("unused"),
    marker: `[PPM ${page}]`,
    kind: "slides",
    course: "B028451",
    academic_year: "2025-2026",
    source_file: "PPM-03-immagini.pdf",
    source_sha256: "ab".repeat(32),
    page,
    url: null,
    fetch_date: null,
    heading_path,
  };
}

describe("a source's short name", () => {
  it.each([
    ["https://www.unifi.it/p602.html", "unifi.it"],
    ["https://ingegneria.unifi.it/p536.html", "ingegneria.unifi.it"],
    ["not a url", "not a url"],
  ])("is the host of %s without www.", (url, expected) => {
    expect(hostOf(url)).toBe(expected);
    expect(shortName(web(url), t)).toBe(expected);
  });

  it("is the slide's page for a deck", () => {
    expect(shortName(slide(14), t)).toBe("Slide p. 14");
  });
});

describe("a source's title", () => {
  it("is the document's top heading", () => {
    const page = web("https://ingegneria.unifi.it/p536.html", [
      "Academic periods and class timetable",
      "Academic periods",
    ]);

    expect(titleOf(page)).toBe("Academic periods and class timetable");
  });

  it("falls back to the host and path for a page, and to the file for a deck", () => {
    expect(titleOf(web("https://www.unifi.it/p602.html"))).toBe("unifi.it/p602.html");
    expect(titleOf(web("https://www.unifi.it/"))).toBe("unifi.it");
    expect(titleOf(slide(3, ["  "]))).toBe("PPM-03-immagini.pdf");
  });
});

describe("the sources of an answer", () => {
  it("are one per marker, in retrieval order", () => {
    const first = web("https://www.unifi.it/p602.html");
    const again = { ...first, text: "Un altro estratto della stessa pagina." };

    expect(sourcesOf([first, slide(3), again])).toEqual([first, slide(3)]);
  });
});
