// @vitest-environment jsdom

/**
 * The process line: counting while the search runs, folded into the server's
 * seconds once `start` has said where it looked, and opening onto the steps
 * and the sources.
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

describe("the process line", () => {
  it("counts a second at a time while the search runs", () => {
    vi.useFakeTimers();
    const { container, unmount } = mount(
      <ProcessLine running route={null} searchMs={null} citations={[]} />,
    );
    const first = container.textContent;
    act(() => vi.advanceTimersByTime(2000));
    const later = container.textContent;
    unmount();

    expect([first, later]).toEqual(["Ricerca in corso · 1 s", "Ricerca in corso · 3 s"]);
  });

  it("folds into the server's seconds, rounded up as the count is, once it knows where it looked", () => {
    const { container, unmount } = mount(
      <ProcessLine running route={ROUTE} searchMs={2100} citations={CITATIONS} />,
    );
    const summary = container.querySelector("summary")?.textContent;
    const open = container.querySelector("details")?.open;
    unmount();

    expect({ summary, open }).toEqual({ summary: "Ricerca completata · 3 s", open: false });
  });

  it("gives no seconds for an answer stored before they were kept, and never 0 s", () => {
    const untimed = mount(
      <ProcessLine running={false} route={ROUTE} searchMs={null} citations={[]} />,
    );
    const none = untimed.container.querySelector("summary")?.textContent;
    untimed.unmount();
    const quick = mount(
      <ProcessLine running={false} route={ROUTE} searchMs={300} citations={[]} />,
    );
    const one = quick.container.querySelector("summary")?.textContent;
    quick.unmount();

    expect([none, one]).toEqual(["Ricerca completata", "Ricerca completata · 1 s"]);
  });

  it("opens onto where it searched, how much it read, and each source once", () => {
    const { container, unmount } = mount(
      <ProcessLine running={false} route={ROUTE} searchMs={2600} citations={CITATIONS} />,
    );
    const steps = [...container.querySelectorAll("details > ol > li")].map(
      (step) => step.firstChild?.textContent,
    );
    const sources = [...container.querySelectorAll("details ul > li")].map(
      (row) => row.textContent,
    );
    unmount();

    expect(steps).toEqual(["Cercato in pagine di ateneo", "Letti 3 estratti"]);
    expect(sources).toEqual([
      "Iscrizioniunifi.it",
      "Academic periods and class timetableingegneria.unifi.it",
    ]);
  });

  it("says nothing when the question was refused before any search", () => {
    const { container, unmount } = mount(
      <ProcessLine running={false} route={null} searchMs={null} citations={[]} />,
    );
    const html = container.innerHTML;
    unmount();

    expect(html).toBe("");
  });
});
