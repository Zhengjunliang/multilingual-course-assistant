// @vitest-environment jsdom

/**
 * The process line says how the answer was searched, loudly enough to be
 * read, and the sources come after the answer rather than above it.
 *
 * Both are assertions about the `start` event being spent rather than stored:
 * the route and the citations arrive together, before the first token, and the
 * point is to put that fact on the screen at the moment it is true.
 *
 * The document is for one case. How loud the process line is depends on which
 * element around it carries a type size, and a string render can only answer
 * that by naming the tag; a mounted turn answers it with `closest`.
 */

import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";

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

/** The wait a busy refusal sets before the question is asked again. */
const RETRY = { seconds: 5, attempt: 1 };

function view(
  t: Turn,
  live = false,
  thinking = false,
  visitor = false,
  retry: typeof RETRY | null = null,
): string {
  // A router because a visitor's turn may link to the login page.
  return render(
    <MemoryRouter>
      <TurnView turn={t} live={live} thinking={thinking} retry={retry} visitor={visitor} />
    </MemoryRouter>,
  );
}

describe("the process line", () => {
  it("is one folded line, which names where the answer was searched once opened", () => {
    const html = view(turn());

    expect(html).toContain("<details");
    expect(html).toContain("Ricerca completata · 3 s");
    // Where it searched is a chip inside the sentence.
    expect(html).toMatch(/Cercato in <span[^>]*>entrambe le fonti<\/span>/);
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
      <TurnView turn={turn()} live={false} thinking={false} retry={null} visitor={false} />,
    );
    const line = container.querySelector("summary")?.closest(TYPE_SIZES);
    if (line == null) throw new Error("no type size is set around the process line");

    expect([...line.classList]).toContain("text-body");
    expect([...line.classList]).not.toContain("text-caption");

    unmount();
  });
});

describe("the order of a turn", () => {
  it("puts the answer first and its sources after it", () => {
    const html = view(turn());
    const line = html.indexOf("Ricerca completata");
    const answer = html.indexOf("La scadenza");
    const sources = html.indexOf("Fonti");

    expect(line).toBeGreaterThan(-1);
    expect([line < answer, answer < sources]).toEqual([true, true]);
  });

  it("has nothing under the answer while it is still being written", () => {
    const html = view(turn({ answer: "La scadenza", complete: false }), true);

    expect(html).not.toContain("Fonti");
    expect(html).not.toContain("Copia la risposta");
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
        retry={null}
        visitor={false}
      />,
    );
    const prose = container.querySelector('div[lang="zh"]');
    const marked = [...container.querySelectorAll("[lang]")].map((element) =>
      element.getAttribute("lang"),
    );
    const classes = [...(prose?.classList ?? [])];
    const text = prose?.textContent;
    const question = [...container.querySelectorAll("p[lang]")]
      .find((element) => element.textContent === "学费什么时候截止？")
      ?.getAttribute("lang");
    unmount();

    expect(text).toContain("学费九月三十日截止");
    // The page's sans, which `lang` turns into the Chinese stack: no family of
    // its own on the prose (DESIGN.md, Typography).
    expect(classes).toContain("text-reading");
    expect(classes.filter((name) => /^font-(sans|mono)$/.test(name))).toEqual([]);
    // The process line is the interface's language and each source its own;
    // only the question and the answer say "zh".
    expect(question).toBe("zh");
    expect(marked.filter((lang) => lang === "zh")).toHaveLength(2);
  });

  it("is on a chip under each question once the server has said it", () => {
    // The code a reader sees, the name a screen reader hears; before `start`
    // the language is not known, and nothing is guessed.
    const chipOf = (of: Turn) => {
      const { container, unmount } = mounted(of);
      const bubble = container.querySelector("article > div");
      const seen = {
        code: bubble?.querySelector("[aria-hidden]")?.textContent ?? null,
        name: bubble?.querySelector(".sr-only")?.textContent ?? null,
      };
      unmount();
      return seen;
    };

    expect(chipOf(turn({ locale: "en" }))).toEqual({ code: "EN", name: "inglese" });
    expect(chipOf(turn({ locale: null, route: null, answer: "", complete: false }))).toEqual({
      code: null,
      name: null,
    });
  });
});

describe("the cat beside the answer", () => {
  const poseIn = (html: string) => /data-pose="(\w+)"/.exec(html)?.[1];

  it("thinks until the first word arrives", () => {
    expect(poseIn(view(turn({ answer: "", complete: false }), false, true))).toBe("thinking");
  });

  it("keeps thinking while a busy refusal is waited out, when no search is counted", () => {
    const html = view(
      turn({ route: null, searchMs: null, citations: [], answer: "", complete: false }),
      false,
      true,
      false,
      RETRY,
    );

    expect(poseIn(html)).toBe("thinking");
    expect(html).not.toContain("Ricerca in corso");
  });

  it("is just there once the answer is", () => {
    expect(poseIn(view(turn()))).toBe("avatar");
  });

  it("apologises for an answer that failed", () => {
    const failed = turn({ complete: false, failure: { kind: "interrupted" } });

    expect(poseIn(view(failed))).toBe("error");
  });
});

/** The button under the answer that opens its sources, named with how many there are. */
function sourcesButton(container: HTMLElement) {
  return container.querySelector<HTMLButtonElement>('button[aria-label^="Fonti ("]');
}

function mounted(of: Turn) {
  return mount(<TurnView turn={of} live={false} thinking={false} retry={null} visitor={false} />);
}

const CALENDAR_URL = "https://ingegneria.unifi.it/p537.html";
const CALENDAR_MARKER = `[${CALENDAR_URL} · 2026-09-20]`;
const CALENDAR_TEXTS = [
  "Pausa pasquale dal 2 al 7 aprile 2026.",
  "Lezioni del secondo periodo dal 2 marzo 2026.",
  "Sessione invernale 2025-26 dal 19 gennaio al 28 febbraio 2026.",
  "Sessione invernale 2026-27 dal 18 gennaio al 27 febbraio 2027.",
];

/** Four excerpts of one page, as #182 found them: they share its marker. */
const CALENDAR = CALENDAR_TEXTS.map(
  (text): Citation => ({
    ...citation(CALENDAR_MARKER, 1),
    kind: "web",
    text,
    heading_path: ["Calendario didattico"],
    source_file: "",
    source_sha256: null,
    url: CALENDAR_URL,
    fetch_date: "2026-09-20",
  }),
);

/**
 * Where a pill opens the page, and which of the page's excerpts its card
 * shows once focus has rested on it for the card's delay
 * (components/ui/hover-card.tsx). Needs fake timers.
 */
function opened(pill: HTMLAnchorElement) {
  const href = pill.getAttribute("href") ?? "";
  act(() => pill.focus());
  act(() => vi.advanceTimersByTime(200));
  const card =
    document.body.querySelector("[data-radix-popper-content-wrapper]")?.textContent ?? "";
  act(() => pill.blur());
  act(() => vi.advanceTimersByTime(150));
  return {
    // The passage the page opens at: its text fragment, decoded.
    at: decodeURIComponent(href.split("#:~:text=")[1] ?? ""),
    shows: CALENDAR_TEXTS.filter((text) => card.includes(text)),
  };
}

describe("a pill in the answer", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("names its source, and a click opens the source in a new tab", () => {
    const { container, unmount } = mounted(turn());
    const pill = container.querySelector<HTMLAnchorElement>("a[data-pill]");
    const seen = {
      text: pill?.textContent,
      href: pill?.getAttribute("href"),
      target: pill?.target,
      label: pill?.getAttribute("aria-label"),
    };
    unmount();

    expect(seen).toEqual({
      text: "Slide p. 3",
      href: `/api/sources/${"ab".repeat(32)}#page=3`,
      target: "_blank",
      label: "Slide p. 3, fonte",
    });
  });

  it("merged, is named by what it shows and then every source it stands for", () => {
    // WCAG 2.5.3: a voice user says what they see, «Slide p. 3 +1».
    const { container, unmount } = mounted(
      turn({ answer: "La scadenza è il 30 settembre. [Excerpt 1] [Excerpt 2]" }),
    );
    const pills = [...container.querySelectorAll("a[data-pill]")].map((pill) => ({
      text: pill.textContent,
      label: pill.getAttribute("aria-label"),
    }));
    unmount();

    expect(pills).toEqual([
      { text: "Slide p. 3 +1", label: "Slide p. 3 +1, fonti: Slide p. 3, Slide p. 4" },
    ]);
  });

  it("cited by excerpt number, previews and opens that excerpt, not its page's first", () => {
    // #182: asked when the winter exam session is, the answer cited two
    // excerpts of one page by number, and both pills showed the first.
    vi.useFakeTimers();
    const { container, unmount } = mounted(
      turn({
        answer:
          "La sessione 2025-26 inizia il 19 gennaio [Excerpt 3], quella 2026-27 il 18 gennaio [Excerpt 4].",
        citations: CALENDAR,
      }),
    );
    const pills = [...container.querySelectorAll<HTMLAnchorElement>("a[data-pill]")].map(opened);
    unmount();

    expect(pills).toEqual([
      { at: expect.stringContaining("Sessione invernale 2025-26"), shows: [CALENDAR_TEXTS[2]] },
      { at: expect.stringContaining("Sessione invernale 2026-27"), shows: [CALENDAR_TEXTS[3]] },
    ]);
  });

  it("merged over two excerpts of one page, previews the page once, at the first number it names", () => {
    // One card entry per page, as «+N» counts them: a run of five excerpts of
    // two pages made a card taller than the window.
    vi.useFakeTimers();
    const { container, unmount } = mounted(
      turn({ answer: "Le sessioni invernali [Excerpt 4][Excerpt 3].", citations: CALENDAR }),
    );
    const pills = [...container.querySelectorAll<HTMLAnchorElement>("a[data-pill]")].map(opened);
    unmount();

    expect(pills).toEqual([
      { at: expect.stringContaining("Sessione invernale 2026-27"), shows: [CALENDAR_TEXTS[3]] },
    ]);
  });

  it("shows its source's kind, and keeps its fill and stays out of the accent in every state", () => {
    // DESIGN.md, Colors: the fill says "clickable", the pointer turns the edge
    // to ink and an open card the whole pill; blue would read as a link.
    const { container, unmount } = mounted(turn());
    const pill = container.querySelector<HTMLAnchorElement>("a[data-pill]");
    const seen = { icon: pill?.querySelector("svg") !== null, classes: pill?.className ?? "" };
    unmount();

    expect(seen.icon).toBe(true);
    expect(seen.classes).toContain("bg-mark");
    expect(seen.classes).toContain("hover:border-ink");
    expect(seen.classes).toContain("data-[state=open]:bg-ink");
    expect(seen.classes).not.toMatch(/hover:bg-|accent/);
  });

  it("previews its source with the passage its link quotes marked, for a page and a slide", () => {
    vi.useFakeTimers();
    const page: Citation = {
      ...CALENDAR[0],
      text: "## Calendario\nSessione invernale 2025-26 dal 19 gennaio al 28 febbraio 2026.\nInfo.",
    } as Citation;
    const slide: Citation = {
      ...citation("[Excerpt 2]", 4),
      text: "BCNF\nUna relazione è in BCNF se ogni dipendenza ha una superchiave a sinistra.",
    };
    const { container, unmount } = mounted(
      turn({ answer: "Le date [Excerpt 1] e la forma [Excerpt 2].", citations: [page, slide] }),
    );
    const marked = [...container.querySelectorAll<HTMLAnchorElement>("a[data-pill]")].map(
      (pill) => {
        act(() => pill.focus());
        act(() => vi.advanceTimersByTime(200));
        const card = document.body.querySelector("[data-radix-popper-content-wrapper]");
        const seen = {
          mark: card?.querySelector("mark")?.textContent,
          link: decodeURIComponent(pill.getAttribute("href") ?? ""),
        };
        act(() => pill.blur());
        act(() => vi.advanceTimersByTime(150));
        return seen;
      },
    );
    unmount();

    expect(marked).toEqual([
      {
        mark: "Sessione invernale 2025-26 dal 19 gennaio al 28 febbraio 2026.",
        link: expect.stringContaining(":~:text=Sessione invernale 2025-26 dal"),
      },
      {
        mark: "Una relazione è in BCNF se ogni dipendenza ha una superchiave a sinistra.",
        link: expect.stringContaining("#page=4"),
      },
    ]);
  });

  it("speaks the interface's language inside an answer in another", () => {
    const { container, unmount } = mounted(turn({ locale: "en" }));
    const pill = container.querySelector("a[data-pill]");
    const spoken = pill?.closest("[lang]")?.getAttribute("lang");
    const answer = pill?.parentElement?.closest("[lang]")?.getAttribute("lang");
    unmount();

    expect({ spoken, answer }).toEqual({ spoken: "it", answer: "en" });
  });

  it("closes its card on Escape", () => {
    vi.useFakeTimers();
    const { container, unmount } = mounted(turn());
    const pill = container.querySelector<HTMLAnchorElement>("a[data-pill]");
    const card = () => document.body.querySelector("[data-radix-popper-content-wrapper]");

    act(() => pill?.focus());
    act(() => vi.advanceTimersByTime(200));
    const opened = card() !== null;
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    const closed = card() === null;
    unmount();

    expect({ opened, closed }).toEqual({ opened: true, closed: true });
  });

  it("cited by the page's marker, previews and opens the page's first excerpt", () => {
    vi.useFakeTimers();
    const { container, unmount } = mounted(
      turn({ answer: `Le date sono nel calendario ${CALENDAR_MARKER}.`, citations: CALENDAR }),
    );
    const pills = [...container.querySelectorAll<HTMLAnchorElement>("a[data-pill]")].map(opened);
    unmount();

    expect(pills).toEqual([
      { at: expect.stringContaining("Pausa pasquale"), shows: [CALENDAR_TEXTS[0]] },
    ]);
  });
});

describe("the row under the answer", () => {
  it("copies the answer without its markers, and says so", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (text: string) => void written.push(text) },
    });
    const { container, unmount } = mounted(turn());
    const copy = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Copia la risposta",
    );

    await act(async () => copy?.click());
    const said = container.querySelector('[role="status"]')?.textContent;
    unmount();

    expect(written).toEqual(["La scadenza è il 30 settembre."]);
    expect(said).toBe("Risposta copiata");
    expect(copy?.textContent).toBe("Risposta copiata");
  });

  it("opens the sources, the cited one first and the rest after it, none marked unused", () => {
    const { container, unmount } = mounted(turn());
    const open = sourcesButton(container);

    act(() => open?.click());
    const panel = document.body.querySelector('[role="dialog"]');
    const lists = [...(panel?.querySelectorAll("ol") ?? [])].map((list) =>
      [...list.querySelectorAll("a")].map((row) => row.getAttribute("href")),
    );
    const text = panel?.textContent ?? "";
    unmount();

    const at = (page: number) => `/api/sources/${"ab".repeat(32)}#page=${page}`;
    expect(lists).toEqual([[at(3)], [at(4), at(5)]]);
    expect(text).toContain("Altre consultate"); // spellchecker:disable-line
    expect(text).not.toContain("non citata");
  });

  it("lists every source as one when the answer cited none of them", () => {
    const { container, unmount } = mounted(turn({ answer: "La scadenza è il 30 settembre." }));
    const open = sourcesButton(container);

    act(() => open?.click());
    const panel = document.body.querySelector('[role="dialog"]');
    const lists = [...(panel?.querySelectorAll("ol") ?? [])].map(
      (list) => list.querySelectorAll("a").length,
    );
    const text = panel?.textContent ?? "";
    unmount();

    expect(lists).toEqual([3]);
    expect(text).not.toContain("Altre consultate"); // spellchecker:disable-line
  });

  it("shows an Italian question's language on its bubble and an English slide's on its row", () => {
    const english: Citation = { ...citation("[Excerpt 1]", 31), locale: "en" };
    const { container, unmount } = mounted(turn({ citations: [english] }));
    const bubble = container.querySelector("article > div [aria-hidden]")?.textContent;

    act(() => sourcesButton(container)?.click());
    const row = document.body.querySelector('[role="dialog"] li');
    const chip = row?.querySelector("[aria-hidden]:not(svg)")?.textContent;
    const said = row?.querySelector(".sr-only")?.textContent;
    unmount();

    expect({ bubble, chip, said }).toEqual({ bubble: "IT", chip: "EN", said: "inglese" });
  });

  it("narrows to one kind of source, and its groups and their counts follow", () => {
    const others = "Altre consultate"; // spellchecker:disable-line
    const web: Citation = {
      ...CALENDAR[0],
      marker: "[https://www.unifi.it/tasse · 2026-09-20]",
      url: "https://www.unifi.it/tasse",
    } as Citation;
    const { container, unmount } = mounted(
      turn({ citations: [citation("[Excerpt 1]", 3), citation("[Excerpt 2]", 4), web] }),
    );
    act(() => sourcesButton(container)?.click());
    const panel = () => document.body.querySelector('[role="dialog"]');
    const seen = () => ({
      headings: [...(panel()?.querySelectorAll("h3") ?? [])].map((h) => h.textContent),
      rows: panel()?.querySelectorAll("li").length,
    });
    const pick = (name: string) =>
      act(() =>
        [...(panel()?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])]
          .find((option) => option.textContent?.startsWith(name))
          ?.click(),
      );

    const all = seen();
    pick("Web");
    const web_ = seen();
    pick("Slide");
    const slides = seen();
    unmount();

    expect(all).toEqual({ headings: ["Citate nella risposta1", `${others}2`], rows: 3 });
    expect(web_).toEqual({ headings: [`${others}1`], rows: 1 });
    expect(slides).toEqual({ headings: ["Citate nella risposta1", `${others}1`], rows: 2 });
  });

  it("lists every source as one, with no heading, under an answer that did not finish", () => {
    const { container, unmount } = mounted(
      turn({ complete: false, failure: { kind: "interrupted" } }),
    );

    act(() => sourcesButton(container)?.click());
    const panel = document.body.querySelector('[role="dialog"]');
    const seen = {
      headings: panel?.querySelectorAll("h3").length,
      rows: panel?.querySelectorAll("li").length,
    };
    unmount();

    expect(seen).toEqual({ headings: 0, rows: 3 });
  });

  it("marks a row's pills while the row has the focus, and lets go when the panel closes", () => {
    const { container, unmount } = mounted(turn());
    const pill = () => container.querySelector("a[data-pill]");
    act(() => sourcesButton(container)?.click());
    const link = document.body.querySelector<HTMLAnchorElement>('[role="dialog"] li a');

    act(() => link?.focus());
    const marked = pill()?.hasAttribute("data-highlighted");
    act(() => {
      document.activeElement?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
      );
    });
    const closed = document.body.querySelector('[role="dialog"]') === null;
    const left = pill()?.hasAttribute("data-highlighted");
    unmount();

    expect({ marked, closed, left }).toEqual({ marked: true, closed: true, left: false });
  });

  it("keeps the focused row's pills marked while the pointer passes over another row", () => {
    const { container, unmount } = mounted(turn({ answer: "Prima [Excerpt 1]. Poi [Excerpt 2]." }));
    const marked = () =>
      [...container.querySelectorAll("a[data-pill]")].map((pill) =>
        pill.hasAttribute("data-highlighted"),
      );
    act(() => sourcesButton(container)?.click());
    const [first, second] = document.body.querySelectorAll<HTMLLIElement>('[role="dialog"] li');

    act(() => first?.querySelector("a")?.focus());
    const focused = marked();
    // React derives enter and leave from `pointerover` and `pointerout`.
    act(() => {
      second?.dispatchEvent(new MouseEvent("pointerover", { bubbles: true }));
    });
    const pointed = marked();
    act(() => {
      second?.dispatchEvent(new MouseEvent("pointerout", { bubbles: true }));
    });
    const left = marked();
    unmount();

    expect({ focused, pointed, left }).toEqual({
      focused: [true, false],
      pointed: [false, true],
      left: [true, false],
    });
  });

  it("forgets the row under the pointer once a filter takes it away", () => {
    // The row goes without the pointer ever leaving it, so no leave is heard.
    const web: Citation = {
      ...CALENDAR[0],
      marker: "[https://www.unifi.it/tasse · 2026-09-20]",
      url: "https://www.unifi.it/tasse",
    } as Citation;
    const { container, unmount } = mounted(
      turn({
        answer: `Prima [Excerpt 1]. Poi ${web.marker}.`,
        citations: [citation("[Excerpt 1]", 3), citation("[Excerpt 2]", 4), web],
      }),
    );
    const marked = () =>
      [...container.querySelectorAll("a[data-pill]")].map((pill) =>
        pill.hasAttribute("data-highlighted"),
      );
    act(() => sourcesButton(container)?.click());
    const panel = () => document.body.querySelector('[role="dialog"]');
    const rowOf = (href: string) =>
      [...(panel()?.querySelectorAll("li") ?? [])].find((row) =>
        row.querySelector("a")?.getAttribute("href")?.startsWith(href),
      );

    act(() => {
      rowOf("https://www.unifi.it/tasse")?.dispatchEvent(
        new MouseEvent("pointerover", { bubbles: true }),
      );
    });
    const pointed = marked();
    act(() =>
      [...(panel()?.querySelectorAll<HTMLButtonElement>('[role="radio"]') ?? [])]
        .find((option) => option.textContent?.startsWith("Slide"))
        ?.click(),
    );
    act(() => rowOf("/api/sources/")?.querySelector("a")?.focus());
    const focused = marked();
    unmount();

    expect({ pointed, focused }).toEqual({ pointed: [false, true], focused: [true, false] });
  });

  it("gives focus back to the sources button when the panel closes", async () => {
    const { container, unmount } = mounted(turn());
    const open = sourcesButton(container);

    act(() => {
      open?.focus();
      open?.click();
    });
    const close = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Chiudi le fonti"]',
    );
    await act(async () => {
      close?.click();
    });
    // Radix moves focus back a task after the panel unmounts, which a loaded
    // machine can push past a single `setTimeout(0)`: one run in four of the
    // chat tests failed that way on 12 October 2026. Waited for, at most a
    // second, rather than raced.
    const focused = await vi
      .waitFor(() => {
        if (document.activeElement !== open) throw new Error("focus is elsewhere");
      })
      .then(
        () => true,
        () => false,
      );
    const expanded = open?.getAttribute("aria-expanded");
    unmount();

    expect({ focused, expanded }).toEqual({ focused: true, expanded: "false" });
  });
});

describe("a turn that did not get all the way", () => {
  const cut = turn({ answer: "La scadenza è", complete: false, failure: { kind: "interrupted" } });

  /** What the warning banner shows, and the role it carries. */
  function banner(of: Turn, { visitor = false } = {}) {
    const { container, unmount } = mount(
      <MemoryRouter>
        <TurnView turn={of} live={false} thinking={false} retry={null} visitor={visitor} />
      </MemoryRouter>,
    );
    const shown = container.querySelector(".bg-warn");
    const seen = { text: shown?.textContent ?? null, role: shown?.getAttribute("role") ?? null };
    unmount();
    return seen;
  }

  it("says in a warning banner that the answer stopped, and that what was written is kept", () => {
    expect(banner(cut).text).toBe(
      "La risposta si è interrotta prima della fine.Quello che vedi è stato salvato così com'è.",
    );
  });

  it("promises nothing kept when nothing was written, or for a visitor, whose turn is stored nowhere", () => {
    const heading = "La risposta si è interrotta prima della fine.";

    expect(banner({ ...cut, answer: "" }).text).toBe(heading);
    expect(banner(cut, { visitor: true }).text).toBe(heading);
  });

  it("leaves announcing it to the page's live region, which is there before it happens", () => {
    // A banner inserted with its words in it is not reliably announced; the
    // page says them (notice.ts, routes/ChatPage.tsx).
    expect(banner(cut).role).toBeNull();
  });

  it("says, while a busy server is waited out, how long until the next try and which it is", () => {
    const html = view(
      turn({ route: null, searchMs: null, citations: [], answer: "", complete: false }),
      false,
      true,
      false,
      RETRY,
    );

    expect(html).toContain("C&#x27;è un&#x27;altra domanda in corso.");
    expect(html).toContain("Riprovo tra 5 secondi (1 di 2).");
    expect(html).not.toContain('role="status"');
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
