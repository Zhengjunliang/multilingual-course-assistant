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

function view(t: Turn, live = false, thinking = false, visitor = false, retrying = false): string {
  // A router because a visitor's turn may link to the login page.
  return render(
    <MemoryRouter>
      <TurnView turn={t} live={live} thinking={thinking} retrying={retrying} visitor={visitor} />
    </MemoryRouter>,
  );
}

describe("the process line", () => {
  it("is one folded line, which names where the answer was searched once opened", () => {
    const html = view(turn());

    expect(html).toContain("<details");
    expect(html).toContain("Ricerca completata · 3 s");
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
      <TurnView turn={turn()} live={false} thinking={false} retrying={false} visitor={false} />,
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
        retrying={false}
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
    // The process line is the interface's language and each source its own;
    // only the question and the answer say "zh".
    expect(question).toBe("zh");
    expect(marked.filter((lang) => lang === "zh")).toHaveLength(2);
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
      true,
    );

    expect(poseIn(html)).toBe("thinking");
    expect(html).not.toContain("Ricerca in corso");
  });

  it("is just there once the answer is", () => {
    expect(poseIn(view(turn()))).toBe("avatar");
  });

  it("apologises for an answer that failed", () => {
    const failed = turn({ complete: false, failure: { kind: "incomplete" } });

    expect(poseIn(view(failed))).toBe("error");
  });
});

function mounted(of: Turn) {
  return mount(
    <TurnView turn={of} live={false} thinking={false} retrying={false} visitor={false} />,
  );
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
    const copy = container.querySelector<HTMLButtonElement>(
      'button[aria-label="Copia la risposta"]',
    );

    await act(async () => copy?.click());
    const said = container.querySelector('[role="status"]')?.textContent;
    unmount();

    expect(written).toEqual(["La scadenza è il 30 settembre."]);
    expect(said).toBe("Risposta copiata");
  });

  it("opens the sources, the cited one first and the rest after it, none marked unused", () => {
    const { container, unmount } = mounted(turn());
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent === "Fonti");

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
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent === "Fonti");

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

  it("gives focus back to the sources button when the panel closes", async () => {
    const { container, unmount } = mounted(turn());
    const open = [...container.querySelectorAll("button")].find((b) => b.textContent === "Fonti");

    act(() => {
      open?.focus();
      open?.click();
    });
    const close = document.body.querySelector<HTMLButtonElement>(
      'button[aria-label="Chiudi le fonti"]',
    );
    // Radix moves focus back a task after the panel unmounts.
    await act(async () => {
      close?.click();
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    const focused = document.activeElement === open;
    const expanded = open?.getAttribute("aria-expanded");
    unmount();

    expect({ focused, expanded }).toEqual({ focused: true, expanded: "false" });
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
