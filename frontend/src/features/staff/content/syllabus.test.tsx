// @vitest-environment jsdom

/**
 * An edition's syllabus, read and written as its page does: one section shown
 * at a time, its text rendered from Markdown, what each write sends, what
 * asks first, and what a reader without `edition.edit_content` is offered.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { markdownOf } from "./editorKit";
import {
  BASE,
  button,
  editorIn,
  field,
  key,
  open,
  openEditor,
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
  write,
} from "./harness";

beforeEach(serve);
afterEach(unserve);

const shown = () =>
  text(document.body.querySelector('[role="tab"][aria-selected="true"] span > span'));

describe("a syllabus section", () => {
  it("is saved alone, shown, said, and hands the focus back to its button", async () => {
    const { unmount } = open(true);
    await settle();
    await show("Prerequisiti");
    await openEditor("Prerequisiti", "Modifica");
    write("Prerequisiti", "Fisica I e **Analisi I**.");
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
    await openEditor("Prerequisiti", "Modifica");
    write("Prerequisiti", "");
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
    await openEditor("Prerequisiti", "Modifica");
    write("Prerequisiti", "Altro testo.");
    await press("Annulla");
    const seen = [server.writes.length, text(panel("Prerequisiti")?.querySelector("p"))];
    unmount();

    expect(seen).toEqual([0, "Fisica I."]);
  });

  it("keeps a section half written while another is shown and saved, whatever a later read gives", async () => {
    const { unmount } = open(true);
    await settle();
    await show("Contenuti");
    await openEditor("Contenuti", "Scrivi");
    write("Contenuti", "Campo elettrico.");
    await show("Prerequisiti");
    await openEditor("Prerequisiti", "Modifica");
    write("Prerequisiti", "Fisica I e Analisi I.");
    server.unreadable = true;
    await press("Salva");
    await show("Contenuti");
    const contenuti = editorIn("Contenuti");
    const seen = [
      contenuti === undefined ? null : markdownOf(contenuti),
      text(panel("Prerequisiti")?.querySelector("p")),
    ];
    unmount();

    expect(seen).toEqual(["Campo elettrico.", "Fisica I e Analisi I."]);
  });

  it("keeps its box open on an Escape that ends a word being composed", async () => {
    const { unmount } = open(true);
    await settle();
    await show("Prerequisiti");
    await openEditor("Prerequisiti", "Modifica");
    key("Prerequisiti", { key: "Escape", isComposing: true });
    // Safari, which ends the composition before the key and marks the key 229.
    key("Prerequisiti", { key: "Escape" }, 229);
    const composing = editorIn("Prerequisiti") !== undefined;
    key("Prerequisiti", { key: "Escape" });
    const seen = [composing, editorIn("Prerequisiti") ?? null, server.writes.length];
    unmount();

    expect(seen).toEqual([true, null, 0]);
  });

  it("opens Markdown the editor cannot write as the Markdown it is, so a save keeps all of it", async () => {
    const stored = "# Fisica I\n\nIl campo `E`.\n\n| Prova | Peso |\n| - | - |\n| Orale | 1 |";
    server.syllabus = { locale: "it", sections: [{ section: "prerequisiti", text: stored }] };
    const { unmount } = open(true);
    await settle();
    await show("Prerequisiti");
    await press("Modifica · Prerequisiti");
    const box = () => panel("Prerequisiti")?.querySelector("textarea, [contenteditable='true']");
    for (let turn = 0; turn < 50 && !box(); turn += 1) await settle();
    const area = box();
    if (area instanceof HTMLTextAreaElement) type(area, `${area.value}\n\nNota.`);
    else {
      const editor = editorIn("Prerequisiti");
      write("Prerequisiti", `${editor === undefined ? "" : markdownOf(editor)}\n\nNota.`);
    }
    await press("Salva");
    const seen = [area?.tagName, server.writes];
    unmount();

    expect(seen).toEqual([
      "TEXTAREA",
      [`PUT ${BASE}/syllabus/prerequisiti ${JSON.stringify({ text: `${stored}\n\nNota.` })}`],
    ]);
  });

  it("offers an empty section to be written, and says so in its tab", async () => {
    const { unmount } = open(true);
    await settle();
    await show("Contenuti");
    const seen = {
      empty: [...(panel("Contenuti")?.querySelectorAll("p") ?? [])].map((p) => text(p)),
      write: button("Scrivi · Contenuti") !== undefined,
      captions: ["Prerequisiti", "Contenuti"].map((name) => text(tab(name)?.querySelector("[id]"))),
      // The caption describes the tab, and is no part of its name.
      named: text(tab("Contenuti")),
      where: text(panel("Contenuti")?.querySelector("span")),
    };
    unmount();

    expect(seen).toEqual({
      empty: ["Sezione vuota", "Scrivi il testo con «Scrivi», qui sopra."],
      write: true,
      captions: ["Compilata", "Vuota"],
      named: "Contenuti",
      where: "3 di 7",
    });
  });
});

describe("a section not saved", () => {
  const caption = (name: string) => text(tab(name)?.querySelector("[id]"));

  /** Whether the browser would ask before the tab is closed. */
  function unload() {
    const event = new Event("beforeunload", { cancelable: true });
    window.dispatchEvent(event);
    return event.defaultPrevented;
  }

  async function leave(router: ReturnType<typeof open>["router"]) {
    await act(async () => {
      await router.navigate("/away");
    });
    await settle();
  }

  it("says so in its tab while its box differs from its text, a look at another between", async () => {
    const { unmount } = open(true);
    await settle();
    await show("Contenuti");
    await openEditor("Contenuti", "Scrivi");
    const opened = caption("Contenuti");
    write("Contenuti", "Campo elettrico.");
    await show("Prerequisiti");
    const elsewhere = caption("Contenuti");
    await show("Contenuti");
    await press("Salva");
    const seen = [opened, elsewhere, caption("Contenuti")];
    unmount();

    expect(seen).toEqual(["Vuota", "Non salvata", "Compilata"]);
  });

  it("is not said of a box left as it opened on text the editor writes otherwise", async () => {
    // `*` items, where the editor writes `-`, and a list last, after which it adds a paragraph.
    server.syllabus = {
      locale: "it",
      sections: [{ section: "prerequisiti", text: "Fisica I:\n\n* Analisi\n* Algebra" }],
    };
    const { unmount } = open(true);
    await settle();
    await show("Prerequisiti");
    await openEditor("Prerequisiti", "Modifica");
    const opened = caption("Prerequisiti");
    const asked = unload();
    await press("Salva");
    const seen = [opened, asked, server.writes.length];
    unmount();

    expect(seen).toEqual(["Compilata", false, 0]);
  });

  it("lets the page go while every box holds the text it opened on", async () => {
    const { router, unmount } = open(true);
    await settle();
    await show("Prerequisiti");
    await openEditor("Prerequisiti", "Modifica");
    const asked = unload();
    await leave(router);
    const seen = [
      asked,
      router.state.location.pathname,
      document.body.querySelector('[role="alertdialog"]'),
    ];
    unmount();

    expect(seen).toEqual([false, "/away", null]);
  });

  it("asks before the page is left, and stays or leaves as answered", async () => {
    const { router, unmount } = open(true);
    await settle();
    await show("Prerequisiti");
    await openEditor("Prerequisiti", "Modifica");
    write("Prerequisiti", "Fisica I e Analisi I.");
    const asked = unload();
    await leave(router);
    const question = text(document.body.querySelector('[role="alertdialog"] p'));
    const blocked = router.state.location.pathname;
    await press("Resta");
    const prerequisiti = editorIn("Prerequisiti");
    const stayed = [
      router.state.location.pathname,
      document.body.querySelector('[role="alertdialog"]'),
      prerequisiti === undefined ? null : markdownOf(prerequisiti),
    ];
    await leave(router);
    await press("Esci");
    const seen = {
      asked,
      question,
      blocked,
      stayed,
      left: router.state.location.pathname,
      // The page is gone, and its question on closing the tab with it.
      after: unload(),
      writes: server.writes.length,
    };
    unmount();

    expect(seen).toEqual({
      asked: true,
      question: "Una sezione ha modifiche non salvate, che uscendo andranno perse.",
      blocked: "/",
      stayed: ["/", null, "Fisica I e Analisi I."],
      left: "/away",
      after: false,
      writes: 0,
    });
  });
});

describe("the editor", () => {
  it("names its tools, says which apply where the cursor is, and writes bold as Markdown", async () => {
    server.syllabus.sections = [
      { section: "obiettivi_formativi", text: "**Conoscenze** e metodi" },
    ];
    const { unmount } = open(true);
    await settle();
    await openEditor("Obiettivi formativi", "Modifica");
    const editor = editorIn("Obiettivi formativi");
    const tools = () =>
      [...(panel("Obiettivi formativi")?.querySelectorAll('[role="toolbar"] button') ?? [])].map(
        (tool) => `${tool.getAttribute("aria-label")} ${tool.getAttribute("aria-pressed")}`,
      );
    act(() => {
      editor?.commands.setTextSelection(3);
    });
    const inBold = tools();
    act(() => {
      editor?.commands.setTextSelection({ from: 14, to: 20 });
    });
    act(() => {
      panel("Obiettivi formativi")
        ?.querySelector<HTMLButtonElement>('[aria-label="Grassetto"]')
        ?.click();
    });
    await press("Salva");
    unmount();

    expect(inBold).toEqual([
      "Grassetto true",
      "Corsivo false",
      "Elenco puntato false",
      "Elenco numerato false",
      "Collegamento false",
    ]);
    expect(server.writes).toEqual([
      `PUT ${BASE}/syllabus/obiettivi_formativi {"text":"**Conoscenze** e **metodi**"}`,
    ]);
  });

  it("saves on Ctrl Enter without breaking the line", async () => {
    const { unmount } = open(true);
    await settle();
    await show("Prerequisiti");
    await openEditor("Prerequisiti", "Modifica");
    write("Prerequisiti", "Fisica I.\n\nAnalisi I.");
    key("Prerequisiti", { key: "Enter", ctrlKey: true });
    await settle();
    unmount();

    expect(server.writes).toEqual([
      `PUT ${BASE}/syllabus/prerequisiti ${JSON.stringify({ text: "Fisica I.\n\nAnalisi I." })}`,
    ]);
  });

  it("asks for a link on Ctrl K, which the page's search never hears, and refuses a script", async () => {
    const heard: string[] = [];
    const listen = (event: KeyboardEvent) => heard.push(event.key);
    window.addEventListener("keydown", listen);
    const { unmount } = open(true);
    await settle();
    await show("Prerequisiti");
    await openEditor("Prerequisiti", "Modifica");
    act(() => {
      editorIn("Prerequisiti")?.commands.setTextSelection(1);
    });
    key("Prerequisiti", { key: "k", ctrlKey: true });
    await settle();
    const address = document.body.querySelector<HTMLInputElement>('[role="dialog"] input');
    type(address, "javascript:alert(1)");
    await press("Applica");
    const refused = text(document.getElementById(`${address?.id}-error`));
    type(address, "www.unifi.it");
    await press("Applica");
    const prerequisiti = editorIn("Prerequisiti");
    const seen = {
      heard,
      refused,
      open: document.body.querySelector('[role="dialog"]') !== null,
      text: prerequisiti === undefined ? null : markdownOf(prerequisiti),
    };
    window.removeEventListener("keydown", listen);
    unmount();

    expect(seen).toEqual({
      heard: [],
      refused: "Non è un indirizzo web: scrivilo come https://www.unifi.it.",
      open: false,
      text: "[https://www.unifi.it/](https://www.unifi.it/)Fisica I.",
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

it("sends a language chosen while another is on its way after it, and shows and says the last alone", async () => {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const answer = globalThis.fetch;
  const sent: string[] = [];
  vi.stubGlobal("fetch", async (input: RequestInfo | URL, init: RequestInit = {}) => {
    if (init.method === "PATCH") {
      sent.push(String(init.body));
      // English is answered only once the next choice has been made.
      if (String(init.body).includes('"en"')) await gate;
    }
    return answer(input, init);
  });
  const { unmount } = open(true);
  await settle();
  const select = field("Lingua del syllabus") as unknown as HTMLSelectElement | null;
  // Two presses of an arrow: two tasks, the first one's request sent in between.
  type(select, "en");
  await settle();
  type(select, "zh-hans");
  await settle();
  const waiting = [...sent];
  release();
  await settle();
  const seen = {
    waiting,
    sent,
    shown: select?.value,
    said: status(),
    stored: server.syllabus.locale,
  };
  unmount();

  expect(seen).toEqual({
    waiting: ['{"locale":"en"}'],
    sent: ['{"locale":"en"}', '{"locale":"zh-hans"}'],
    shown: "zh-hans",
    said: "Lingua del syllabus: 简体中文.",
    stored: "zh-hans",
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
