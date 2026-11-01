// @vitest-environment jsdom

/**
 * The process line: the steps as they happen while the search runs, folded
 * into the server's seconds once `start` has said where it looked, and opening
 * onto where, how much it read and cited, in which languages, and how long
 * each step took.
 */

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { Citation, RouteDecision } from "@/api/contract";
import { mount } from "@/test/mount";
import { ProcessLine } from "./ProcessLine";

const ROUTE: RouteDecision = {
  target: "unifi_web",
  query: "iscrizioni",
  fresh: false,
  reason: "campus question",
};

function page(url: string, heading: string, text = "Un estratto."): Citation {
  return {
    marker: `[${url} · 2026-09-20]`,
    kind: "web",
    text,
    heading_path: [heading],
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

const CITATIONS = [
  page("https://www.unifi.it/p602.html", "Iscrizioni"),
  page("https://www.unifi.it/p602.html", "Iscrizioni", "Un altro estratto della stessa pagina."),
  page("https://ingegneria.unifi.it/p536.html", "Academic periods and class timetable"),
];

afterEach(() => {
  vi.useRealTimers();
});

/** The text of each step's row, its words and then its seconds. */
function stepRows(container: HTMLElement, selector: string): string[] {
  return [...container.querySelectorAll(selector)].map((row) =>
    [...row.children].map((part) => part.textContent).join("|"),
  );
}

describe("the process line", () => {
  it("is in the queue, counting, until the server says a worker took the question", () => {
    vi.useFakeTimers();
    const { container, unmount } = mount(
      <ProcessLine
        running
        route={null}
        steps={[]}
        searchMs={null}
        citations={[]}
        cited={null}
        locale={null}
      />,
    );
    const first = stepRows(container, "li");
    act(() => vi.advanceTimersByTime(1200));
    const later = stepRows(container, "li");
    unmount();

    expect([first, later]).toEqual([["|In coda|0,0 s"], ["|In coda|1,2 s"]]);
  });

  it("ticks each finished step with the server's seconds, the one under way counting from zero", () => {
    vi.useFakeTimers();
    const { container, unmount } = mount(
      <ProcessLine
        running
        route={null}
        steps={[
          { name: "queue", ms: 2400 },
          { name: "route", ms: null },
        ]}
        searchMs={null}
        citations={[]}
        cited={null}
        locale={null}
      />,
    );
    act(() => vi.advanceTimersByTime(300));
    const rows = stepRows(container, "li");
    unmount();

    expect(rows).toEqual(["|Atteso il turno|2,4 s", "|Capisce la domanda|0,3 s"]);
  });

  it("leaves out a wait in the queue under a second, and claims no count before `start` brings it", () => {
    const { container, unmount } = mount(
      <ProcessLine
        running
        route={null}
        steps={[
          { name: "queue", ms: 300 },
          { name: "route", ms: 1200 },
          { name: "retrieve", ms: 800 },
        ]}
        searchMs={null}
        citations={[]}
        cited={null}
        locale={null}
      />,
    );
    const rows = stepRows(container, "li");
    unmount();

    expect(rows).toEqual(["|Domanda capita|1,2 s", "|Cerca nel materiale|0,8 s"]);
  });

  it("opens, once folded, onto how long each step took, what the search read said on its step alone", () => {
    const { container, unmount } = mount(
      <ProcessLine
        running={false}
        route={ROUTE}
        steps={[
          { name: "queue", ms: 2400 },
          { name: "route", ms: 1200 },
          { name: "retrieve", ms: 800 },
          { name: "generate", ms: 5230 },
        ]}
        searchMs={4400}
        citations={CITATIONS}
        cited={new Set([CITATIONS[0]?.marker ?? ""])}
        locale="it"
      />,
    );
    const rows = stepRows(container, "details li li");
    const read = container.querySelector("details")?.textContent?.match(/Letti/g) ?? [];
    const shimmering = container.querySelectorAll(".shimmer").length;
    unmount();

    expect(rows).toEqual([
      "|Atteso il turno|2,4 s",
      "|Domanda capita|1,2 s",
      "|Trovati 3 estratti · 1 fonte citata|0,8 s",
      "|Risposta scritta|5,2 s",
    ]);
    expect(read).toEqual([]);
    expect(shimmering).toBe(0);
  });

  it("folds into the server's seconds, rounded up as the count is, once it knows where it looked", () => {
    const { container, unmount } = mount(
      <ProcessLine
        running
        route={ROUTE}
        steps={[]}
        searchMs={2100}
        citations={CITATIONS}
        cited={null}
        locale="it"
      />,
    );
    const summary = container.querySelector("summary")?.textContent;
    const open = container.querySelector("details")?.open;
    unmount();

    expect({ summary, open }).toEqual({ summary: "Ricerca completata · 3 s", open: false });
  });

  it("gives no seconds when the server sent none, and never 0 s", () => {
    const untimed = mount(
      <ProcessLine
        running={false}
        route={ROUTE}
        steps={[]}
        searchMs={null}
        citations={[]}
        cited={null}
        locale="it"
      />,
    );
    const none = untimed.container.querySelector("summary")?.textContent;
    untimed.unmount();
    const quick = mount(
      <ProcessLine
        running={false}
        route={ROUTE}
        steps={[]}
        searchMs={300}
        citations={[]}
        cited={null}
        locale="it"
      />,
    );
    const one = quick.container.querySelector("summary")?.textContent;
    quick.unmount();

    expect([none, one]).toEqual(["Ricerca completata", "Ricerca completata · 1 s"]);
  });

  it("opens onto where it searched, how much it read and the answer cited, and the languages", () => {
    // The two excerpts of unifi.it are one source, cited; the English page is
    // the other, not cited. An answer stored before its steps were has no row
    // for them.
    const english = { ...CITATIONS[2], locale: "en" } as Citation;
    const { container, unmount } = mount(
      <ProcessLine
        running={false}
        route={ROUTE}
        steps={[]}
        searchMs={2600}
        citations={[CITATIONS[0], CITATIONS[1], english] as Citation[]}
        cited={new Set([CITATIONS[0]?.marker ?? ""])}
        locale="it"
      />,
    );
    const steps = [...container.querySelectorAll("details > ol > li")].map(
      (step) => step.textContent,
    );
    const listed = container.querySelectorAll("details ul").length;
    unmount();

    expect(steps).toEqual([
      "Cercato in pagine di ateneo",
      "Letti 3 estratti· 1 fonte citata",
      "Domanda in italiano, fonti in italiano e inglese",
    ]);
    // Each source is in the sources panel, not listed again here.
    expect(listed).toBe(0);
  });

  it("names only the question's language when nothing was retrieved, and no count of what was cited", () => {
    const { container, unmount } = mount(
      <ProcessLine
        running={false}
        route={ROUTE}
        steps={[]}
        searchMs={900}
        citations={[]}
        cited={new Set()}
        locale="en"
      />,
    );
    const steps = [...container.querySelectorAll("details > ol > li")].map(
      (step) => step.textContent,
    );
    unmount();

    expect(steps).toEqual([
      "Cercato in pagine di ateneo",
      "Letti 0 estratti",
      "Domanda in inglese",
    ]);
  });

  it("says nothing when the question was refused before any search", () => {
    const { container, unmount } = mount(
      <ProcessLine
        running={false}
        route={null}
        steps={[]}
        searchMs={null}
        citations={[]}
        cited={null}
        locale={null}
      />,
    );
    const html = container.innerHTML;
    unmount();

    expect(html).toBe("");
  });
});
