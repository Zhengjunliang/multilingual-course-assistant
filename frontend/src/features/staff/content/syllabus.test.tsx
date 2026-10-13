// @vitest-environment jsdom

/**
 * An edition's syllabus, read and written as its page does: one section shown
 * at a time, its text rendered from Markdown, what each write sends, what
 * asks first, and what a reader without `edition.edit_content` is offered.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  BASE,
  button,
  open,
  panel,
  press,
  serve,
  server,
  settle,
  show,
  status,
  tab,
  text,
  type,
  unserve,
} from "./harness";

beforeEach(serve);
afterEach(unserve);

const area = (name: string) => panel(name)?.querySelector("textarea");
const shown = () =>
  text(document.body.querySelector('[role="tab"][aria-selected="true"] span > span'));

describe("a syllabus section", () => {
  it("is saved alone, shown, said, and hands the focus back to its button", async () => {
    const { unmount } = open(true);
    await settle();
    await show("Prerequisiti");
    await press("Modifica · Prerequisiti");
    type(area("Prerequisiti"), "Fisica I e **Analisi I**.");
    await press("Salva");
    const seen = {
      writes: [...server.writes],
      shown: panel("Prerequisiti")?.querySelector("p")?.innerHTML,
      status: status(),
      focused: text(document.activeElement),
    };
    unmount();

    expect(seen).toEqual({
      writes: [`PUT ${BASE}/syllabus/prerequisiti {"text":"Fisica I e **Analisi I**."}`],
      shown: "Fisica I e <strong>Analisi I</strong>.",
      status: "Sezione «Prerequisiti» salvata.",
      focused: "Modifica · Prerequisiti",
    });
  });

  it("is cleared only once the reader confirms", async () => {
    const { unmount } = open(true);
    await settle();
    await show("Prerequisiti");
    await press("Modifica · Prerequisiti");
    type(area("Prerequisiti"), "  ");
    await press("Salva");
    const asked = [
      server.writes.length,
      document.body.querySelector('[role="alertdialog"]') !== null,
    ];
    await press("Svuota");
    const seen = {
      asked,
      writes: [...server.writes],
      shown: text(panel("Prerequisiti")?.querySelector("p")),
      caption: text(tab("Prerequisiti")?.querySelector("[id]")),
      status: status(),
    };
    unmount();

    expect(seen).toEqual({
      // Nothing sent before the question was answered.
      asked: [0, true],
      writes: [`PUT ${BASE}/syllabus/prerequisiti {"text":""}`],
      shown: "Sezione vuota",
      caption: "Vuota",
      status: "Sezione «Prerequisiti» svuotata.",
    });
  });

  it("is left as it was on Annulla, with nothing sent", async () => {
    const { unmount } = open(true);
    await settle();
    await show("Prerequisiti");
    await press("Modifica · Prerequisiti");
    type(area("Prerequisiti"), "Altro testo.");
    await press("Annulla");
    const seen = [server.writes.length, text(panel("Prerequisiti")?.querySelector("p"))];
    unmount();

    expect(seen).toEqual([0, "Fisica I."]);
  });

  it("keeps a section half written while another is shown and saved, whatever a later read gives", async () => {
    const { unmount } = open(true);
    await settle();
    await show("Contenuti");
    await press("Scrivi · Contenuti");
    type(area("Contenuti"), "Campo elettrico.");
    await show("Prerequisiti");
    await press("Modifica · Prerequisiti");
    type(area("Prerequisiti"), "Fisica I e Analisi I.");
    server.unreadable = true;
    await press("Salva");
    await show("Contenuti");
    const seen = [area("Contenuti")?.value, text(panel("Prerequisiti")?.querySelector("p"))];
    unmount();

    expect(seen).toEqual(["Campo elettrico.", "Fisica I e Analisi I."]);
  });

  it("keeps its box open on an Escape that ends a word being composed", async () => {
    const { unmount } = open(true);
    await settle();
    await show("Prerequisiti");
    await press("Modifica · Prerequisiti");
    const box = area("Prerequisiti");
    act(() => {
      box?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }),
      );
    });
    // Safari, which ends the composition before the key and marks the key 229.
    const ended = new KeyboardEvent("keydown", { key: "Escape", bubbles: true });
    Object.defineProperty(ended, "keyCode", { value: 229 });
    act(() => {
      box?.dispatchEvent(ended);
    });
    const composing = area("Prerequisiti") !== null;
    act(() => {
      box?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    const seen = [composing, area("Prerequisiti") ?? null];
    unmount();

    expect(seen).toEqual([true, null]);
  });

  it("offers an empty section to be written, and says so in its tab", async () => {
    const { unmount } = open(true);
    await settle();
    await show("Contenuti");
    const seen = {
      empty: [...(panel("Contenuti")?.querySelectorAll("p") ?? [])].map((p) => text(p)),
      write: button("Scrivi · Contenuti") !== undefined,
      captions: ["Prerequisiti", "Contenuti"].map((name) => text(tab(name)?.querySelector("[id]"))),
      where: text(panel("Contenuti")?.querySelector("span")),
    };
    unmount();

    expect(seen).toEqual({
      empty: ["Sezione vuota", "Scrivi il testo con «Scrivi», qui sopra."],
      write: true,
      captions: ["Compilata", "Vuota"],
      where: "3 di 7",
    });
  });
});

describe("a section's text", () => {
  it("is rendered from Markdown, its raw HTML and a script link left inert", async () => {
    server.syllabus.sections = [
      {
        section: "obiettivi_formativi",
        text: "**Conoscenze**  \nIl corso.\n\n- uno\n- due\n\n[Sito](https://example.org/ai) e [qui](javascript:alert(1)) <b>x</b><script>alert(2)</script>",
      },
    ];
    const { unmount } = open(true);
    await settle();
    const body = panel("Obiettivi formativi");
    const link = body?.querySelector("a");
    const seen = {
      bold: text(body?.querySelector("strong")),
      broken: body?.querySelector("strong + br") !== null,
      items: [...(body?.querySelectorAll("li") ?? [])].map((li) => text(li)),
      link: [link?.getAttribute("href"), link?.getAttribute("target"), link?.getAttribute("rel")],
      links: body?.querySelectorAll("a").length,
      markup: body?.querySelector("b, script") ?? null,
      lang: body?.querySelector("[lang]")?.getAttribute("lang"),
    };
    unmount();

    expect(seen).toEqual({
      bold: "Conoscenze",
      broken: true,
      items: ["uno", "due"],
      link: ["https://example.org/ai", "_blank", "noopener noreferrer"],
      links: 1,
      markup: null,
      lang: "it",
    });
  });
});

describe("the sections", () => {
  it("lead to the ones either side, the focus moving to the section shown", async () => {
    const { unmount } = open(true);
    await settle();
    const first = [shown(), button("Sezione precedente: Altro") ?? null];
    await press("Sezione successiva: Prerequisiti");
    const focused = document.activeElement;
    const second = [shown(), focused?.getAttribute("role"), text(focused?.querySelector("h2"))];
    await show("Altro");
    const last = [
      button("Sezione successiva: Obiettivi formativi") ?? null,
      button("Sezione precedente: Verifica dell'apprendimento") !== undefined,
    ];
    unmount();

    expect([first, second, last]).toEqual([
      ["Obiettivi formativi", null],
      ["Prerequisiti", "tabpanel", "Prerequisiti"],
      [null, true],
    ]);
  });

  it("run down the side on a wide screen and across the top on a narrow one", async () => {
    const wide = vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(min-width: 80rem)",
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    const { unmount } = open(true);
    await settle();
    const across = document.body
      .querySelector('[role="tablist"]')
      ?.getAttribute("aria-orientation");
    unmount();
    wide.mockRestore();
    const narrow = open(true);
    await settle();
    const down = document.body.querySelector('[role="tablist"]')?.getAttribute("aria-orientation");
    narrow.unmount();

    expect([across, down]).toEqual(["vertical", "horizontal"]);
  });
});

describe("the syllabus's language", () => {
  it("is sent on its own, said, and tags the text", async () => {
    const { unmount } = open(true);
    await settle();
    await show("Prerequisiti");
    const select = document.body.querySelector("select");
    const before = select?.value;
    type(select, "en");
    await settle();
    const seen = {
      before,
      writes: [...server.writes],
      after: select?.value,
      status: status(),
      lang: panel("Prerequisiti")?.querySelector("[lang]")?.getAttribute("lang"),
    };
    unmount();

    expect(seen).toEqual({
      before: "it",
      writes: [`PATCH ${BASE}/syllabus {"locale":"en"}`],
      after: "en",
      status: "Lingua del syllabus: English.",
      lang: "en",
    });
  });
});

it("offers no edit to a reader without the permission, and names the language", async () => {
  const { unmount } = open(false);
  await settle();
  await show("Prerequisiti");
  const offered = ["Modifica", "Scrivi", "Aggiungi", "Rimuovi"].filter((word) =>
    [...document.body.querySelectorAll("button")].some((b) => text(b).startsWith(word)),
  );
  const seen = {
    offered,
    text: text(panel("Prerequisiti")?.querySelector("p")),
    select: document.body.querySelector("select"),
    language: text(document.body.querySelector('[role="tablist"] + div')),
    empty: text(panel("Contenuti")?.querySelectorAll("p")[1]),
  };
  unmount();

  expect(seen).toEqual({
    offered: [],
    text: "Fisica I.",
    select: null,
    language: "Lingua del syllabusItaliano",
    empty: "Il syllabus non ha testo per questa sezione.",
  });
});
