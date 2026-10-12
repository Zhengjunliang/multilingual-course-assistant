import { describe, expect, it } from "vitest";

import type { Citation } from "@/api/contract";
import i18n from "@/i18n";
import {
  citationText,
  distinctions,
  excerptAround,
  excerptOf,
  hostOf,
  passageOf,
  shortName,
  sourceLink,
  sourcesOf,
  titleOf,
} from "./sourceLabel";

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

describe("what tells sources apart", () => {
  const GUIDES = "https://ingegneria.unifi.it/upload/sub/guida-dello-studente/";
  const told = (sources: Citation[]) =>
    sources.map((source) => distinctions(sources).get(source.marker));

  it("gives two pages of one host and one title the file names that set them apart", () => {
    const heading = ["Centro Didattico Morgagni"];
    expect(
      told([
        web(`${GUIDES}GUIDA%20STUDENTE%202020-21_ultime%20revisioni.pdf`, heading),
        web(`${GUIDES}guida-studente-2016_2017.pdf`, heading),
        web("https://www.unifi.it/p602.html", heading),
      ]),
    ).toEqual([
      "GUIDA STUDENTE 2020-21_ultime revisioni.pdf",
      "guida-studente-2016_2017.pdf",
      undefined,
    ]);
  });

  it("reaches back to the folders where the file names match, and keeps a query", () => {
    expect(
      told([
        web("https://ingegneria.unifi.it/a/x/index.html", ["Home"]),
        web("https://ingegneria.unifi.it/b/x/index.html", ["Home"]),
        web("https://ingegneria.unifi.it/b/x/index.html?newlang=ita", ["Home"]),
      ]),
    ).toEqual(["a/x/index.html", "b/x/index.html", "index.html?newlang=ita"]);
  });

  it("tells two versions of one page apart by the day each was fetched", () => {
    const crawled = web("https://www.unifi.it/tasse", ["Tasse"]);
    const fetched = {
      ...crawled,
      marker: "[https://www.unifi.it/tasse · 2026-10-12]",
      fetch_date: "2026-10-12",
    };
    expect(told([crawled, fetched])).toEqual(["2026-09-20", "2026-10-12"]);
  });

  it("leaves sources that read differently, and slides, as they are", () => {
    expect(
      told([
        web("https://www.unifi.it/a", ["Tasse"]),
        web("https://www.unifi.it/b", ["Borse"]),
        slide(3, ["Compressione"]),
        slide(4, ["Compressione"]),
      ]),
    ).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe("where a source opens", () => {
  it("is a slide's page in the browser's PDF viewer", () => {
    expect(sourceLink(slide(14))).toBe(`/api/sources/${"ab".repeat(32)}#page=14`);
    expect(sourceLink({ ...slide(14), source_sha256: null })).toBeNull();
  });

  it("is a web page quoting the first and last words of the excerpt's longest line", () => {
    const page = {
      ...web("https://www.unifi.it/p602.html"),
      text: "## Iscrizioni\nLe iscrizioni al primo anno si chiudono il 30 settembre, salvo proroghe.",
    };

    expect(sourceLink(page)).toBe(
      "https://www.unifi.it/p602.html#:~:text=Le%20iscrizioni%20al%20primo,30%20settembre%2C%20salvo%20proroghe.",
    );
  });

  it("quotes a short excerpt whole, escapes a dash, and keeps a fragment already there", () => {
    const page = { ...web("https://www.unifi.it/p602.html#tasse"), text: "Tasse 2026-2027" };

    expect(sourceLink(page)).toBe(
      "https://www.unifi.it/p602.html#tasse:~:text=Tasse%202026%2D2027",
    );
  });

  it("reads the line as the page shows it: no bullet, a link as its text, never a table row", () => {
    // The shape of a crawled excerpt of ingegneria.unifi.it/p537.html: with
    // its bullet, the start term "- From 25 march" matched nothing on the page.
    const bulleted = {
      ...web("https://ingegneria.unifi.it/p537.html"),
      text: "The School establishes the following Easter break period:\n- From 25 march to 14 April 2027 (inclusive), with no lessons.",
    };
    const linked = {
      ...web("https://www.unifi.it/p602.html"),
      text: "1. Compila la [domanda online](https://www.unifi.it/x) entro il 30 settembre",
    };
    const tabled = {
      ...web("https://www.unifi.it/p603.html"),
      text: "Prima rata, Scadenza = 30 settembre 2026 per tutti gli iscritti al primo anno\nLe rate si pagano online.",
    };

    expect([sourceLink(bulleted), sourceLink(linked), sourceLink(tabled)]).toEqual([
      "https://ingegneria.unifi.it/p537.html#:~:text=From%2025%20march%20to,(inclusive)%2C%20with%20no%20lessons.",
      "https://www.unifi.it/p602.html#:~:text=Compila%20la%20domanda%20online%20entro%20il%2030%20settembre",
      "https://www.unifi.it/p603.html#:~:text=Le%20rate%20si%20pagano%20online.",
    ]);
  });

  it("is nothing for a web address that is not an http(s) URL", () => {
    expect(sourceLink(web("javascript:alert(1)//"))).toBeNull();
    expect(sourceLink(web("/relative/page.html"))).toBeNull();
  });

  it("is a PDF on the web as it is, since a PDF viewer reads no text fragment", () => {
    const pdf = "https://ingegneria.unifi.it/upload/sub/CALENDARIO_NOV_DIC_2026_LT.pdf";

    expect(sourceLink(web(pdf))).toBe(pdf);
  });
});

describe("an excerpt as a card shows it", () => {
  it("is the prose without Markdown's marks, whole when short", () => {
    expect(excerptOf("## Iscrizioni\n\n| Rata | 30 settembre |")).toBe(
      "Iscrizioni Rata 30 settembre",
    );
  });

  it("is cut at a word, with an ellipsis, when long", () => {
    const long = `${"parola ".repeat(30)}fine`;
    const shown = excerptOf(long);

    expect(shown.endsWith("parola…")).toBe(true);
    expect(shown.length).toBeLessThanOrEqual(141);
  });

  it("reads its lines as the page shows them: no bullet, a link as its text", () => {
    expect(excerptOf("1. Compila la [domanda online](https://www.unifi.it/x)\n- entro il 30")).toBe(
      "Compila la domanda online entro il 30",
    );
  });
});

describe("the passage a source's link and card mark", () => {
  it("is the longest line as the page shows it, for a page and a slide alike", () => {
    const text =
      "## Tasse\n- Prima rata: 30 settembre, [156 euro](https://www.unifi.it/tasse)\nRata, Scadenza = 30 settembre 2026 per tutti gli iscritti al primo anno";

    expect(passageOf({ ...web("https://www.unifi.it/tasse"), text })).toBe(
      "Prima rata: 30 settembre, 156 euro",
    );
    expect(passageOf({ ...slide(4), text })).toBe("Prima rata: 30 settembre, 156 euro");
  });

  it("is nothing when the excerpt holds only a table row", () => {
    expect(passageOf({ ...slide(4), text: "Rata, Scadenza = 30 settembre" })).toBe("");
  });
});

describe("an excerpt around its passage", () => {
  it("keeps the end of what comes before the passage, and what follows it", () => {
    const text = "## Iscrizioni\nLe iscrizioni al primo anno si chiudono il 30 settembre.\nInfo.";

    expect(excerptAround(text)).toEqual({
      before: "Iscrizioni ",
      passage: "Le iscrizioni al primo anno si chiudono il 30 settembre.",
      after: " Info.",
    });
  });

  it("finds a passage far into the excerpt, with an ellipsis before it", () => {
    const text = `${"Premessa breve.\n".repeat(10)}La seconda rata si paga entro il 31 marzo di ogni anno accademico.`;
    const { before, passage } = excerptAround(text);

    expect(passage).toBe("La seconda rata si paga entro il 31 marzo di ogni anno accademico.");
    expect(before.startsWith("…")).toBe(true);
    expect(before.endsWith("Premessa breve. ")).toBe(true);
    expect(before.length).toBeLessThanOrEqual(50);
  });

  it("cuts a passage too long to show whole, and shows nothing after it", () => {
    const text = `${"parola ".repeat(40)}fine\ncoda`;
    const { passage, after } = excerptAround(text);

    expect(passage.endsWith("parola…")).toBe(true);
    expect(passage.length).toBeLessThanOrEqual(141);
    expect(after).toBe("");
  });

  it("is the excerpt's start, with nothing marked, when no line is a passage", () => {
    expect(excerptAround("Rata, Scadenza = 30 settembre")).toEqual({
      before: "Rata, Scadenza = 30 settembre",
      passage: "",
      after: "",
    });
  });
});

describe("a source as text to paste", () => {
  it("is a page's title and address, or a slide's title, file and page", () => {
    expect(citationText(web("https://www.unifi.it/p602.html", ["Iscrizioni"]), t)).toBe(
      "Iscrizioni — https://www.unifi.it/p602.html",
    );
    expect(citationText(slide(12, ["Forme normali"]), t)).toBe(
      "Forme normali — PPM-03-immagini.pdf · p. 12",
    );
  });
});
