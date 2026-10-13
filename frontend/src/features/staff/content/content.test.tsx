// @vitest-environment jsdom

/**
 * An edition's syllabus and reading list, read and written as their pages do:
 * what each write sends, what asks first, and what a reader without
 * `edition.edit_content` is offered. The network is faked at `fetch` and
 * answers as apps/catalog/content_views.py does, so the bodies and codes
 * travel through `api/http.ts` as they would in the application.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/api/account";
import type { ReadingItem, SyllabusSection } from "@/api/catalog";
import { SessionContext } from "@/auth/SessionProvider";
import { Toaster } from "@/components/ui/sonner";
import { mount } from "@/test/mount";
import { ReadingList } from "./ReadingList";
import { SyllabusPanel } from "./SyllabusPanel";

const READER: Account = {
  id: 1,
  username: "demo-teacher",
  locale: "it",
  is_superuser: false,
  roles: [{ role: "teacher", edition: 5 }],
};
const BASE = "/api/catalog/editions/5";

let syllabus: SyllabusSection[] = [];
let books: ReadingItem[] = [];
/** Whether reading the syllabus fails, as a dropped connection would. */
let unreadable = false;
/** Every write that reached the server, as `METHOD path body`. */
const writes: string[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function fakeApi(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const path = String(input);
  const method = init.method ?? "GET";
  if (method !== "GET") writes.push(`${method} ${path} ${init.body ?? ""}`.trim());
  if (path === `${BASE}/syllabus`) {
    if (unreadable) return json({ detail: { message: "Server error.", code: "error" } }, 500);
    return json(syllabus);
  }
  if (path === `${BASE}/readings` && method === "GET") return json(books);
  const section = path.match(/\/syllabus\/([^/]+)\/([^/]+)$/);
  if (section !== null && method === "PUT") {
    const [, locale, key] = section;
    const { text } = JSON.parse(String(init.body)) as { text: string };
    const row = { locale, section: key, text } as SyllabusSection;
    syllabus = syllabus.filter((r) => r.locale !== locale || r.section !== key);
    if (text.trim() === "") return new Response(null, { status: 204 });
    syllabus = [...syllabus, row];
    return json(row);
  }
  if (path === `${BASE}/readings` && method === "POST") {
    const book = JSON.parse(String(init.body)) as Omit<ReadingItem, "id">;
    if (books.some((listed) => listed.title === book.title && listed.locale === book.locale)) {
      return json({ title: [{ message: "Already listed.", code: "unique" }] }, 400);
    }
    const added = { ...book, id: 30, year: book.year === null ? null : Number(book.year) };
    books = [...books, added];
    return json(added, 201);
  }
  const one = path.match(/\/readings\/(\d+)$/);
  if (one !== null && method === "PATCH") {
    const changes = JSON.parse(String(init.body)) as Partial<ReadingItem>;
    books = books.map((book) => (book.id === Number(one[1]) ? { ...book, ...changes } : book));
    return json(books.find((book) => book.id === Number(one[1])));
  }
  if (one !== null && method === "DELETE") {
    books = books.filter((book) => book.id !== Number(one[1]));
    return new Response(null, { status: 204 });
  }
  return json({ detail: { message: "Not found.", code: "not_found" } }, 404);
}

function open(editable: boolean) {
  return mount(
    <SessionContext
      value={{
        account: READER,
        logIn: async () => {},
        register: async () => {},
        logOut: async () => {},
        chooseLocale: async () => {},
        forget: () => {},
        recheck: async () => {},
      }}
    >
      <main>
        <h1 tabIndex={-1}>FISICA II</h1>
        <SyllabusPanel edition={5} editable={editable} reloadPage={async () => true} />
        <ReadingList edition={5} editable={editable} reloadPage={async () => true} />
      </main>
      <Toaster />
    </SessionContext>,
  );
}

async function settle() {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** What a screen reader reads of `element`: its text without the parts hidden from it. */
function text(element: Element | null | undefined): string {
  if (!element) return "";
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll("[aria-hidden]")) hidden.remove();
  return copy.textContent?.trim() ?? "";
}

/** The first button a screen reader names `label`. */
function button(label: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => text(candidate) === label,
  );
}

async function press(label: string) {
  act(() => {
    // A pointer press moves focus to the button, which jsdom's click does not.
    button(label)?.focus();
    button(label)?.click();
  });
  await settle();
}

function type(field: HTMLInputElement | HTMLTextAreaElement | null | undefined, value: string) {
  const prototype = field instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(prototype.prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

/** The input a visible label names. */
function field(label: string) {
  const tag = [...document.body.querySelectorAll("label")].find((l) => l.textContent === label);
  return document.getElementById(tag?.htmlFor ?? "") as HTMLInputElement | null;
}

/** The Italian tab's section named `name`. */
function section(name: string) {
  return [...document.body.querySelectorAll("li")].find(
    (li) => li.querySelector("h3")?.textContent === name,
  );
}

const status = () => text(document.body.querySelector('[role="status"]'));

const FISICA: ReadingItem = {
  id: 21,
  locale: "it",
  title: "Fisica II",
  authors: "Mazzoldi, Nigro, Voci",
  year: 2021,
  isbn: "",
  url: "",
  importance: "required",
};

beforeEach(() => {
  syllabus = [{ locale: "it", section: "prerequisiti", text: "Fisica I." }];
  books = [FISICA];
  unreadable = false;
  writes.length = 0;
  vi.stubGlobal("fetch", fakeApi);
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("a syllabus section", () => {
  it("is saved alone, shown, said, and hands the focus back to its button", async () => {
    const { unmount } = open(true);
    await settle();
    await press("Modifica · Prerequisiti");
    type(section("Prerequisiti")?.querySelector("textarea"), "Fisica I e Analisi I.");
    await press("Salva");
    const seen = {
      writes: [...writes],
      shown: text(section("Prerequisiti")?.querySelector("p")),
      status: status(),
      focused: text(document.activeElement),
    };
    unmount();

    expect(seen).toEqual({
      writes: [`PUT ${BASE}/syllabus/it/prerequisiti {"text":"Fisica I e Analisi I."}`],
      shown: "Fisica I e Analisi I.",
      status: "Sezione «Prerequisiti» salvata.",
      focused: "Modifica · Prerequisiti",
    });
  });

  it("is cleared only once the reader confirms", async () => {
    const { unmount } = open(true);
    await settle();
    await press("Modifica · Prerequisiti");
    type(section("Prerequisiti")?.querySelector("textarea"), "  ");
    await press("Salva");
    const asked = [writes.length, document.body.querySelector('[role="alertdialog"]') !== null];
    await press("Svuota");
    const seen = {
      asked,
      writes: [...writes],
      shown: text(section("Prerequisiti")?.querySelector("p")),
      status: status(),
    };
    unmount();

    expect(seen).toEqual({
      // Nothing sent before the question was answered.
      asked: [0, true],
      writes: [`PUT ${BASE}/syllabus/it/prerequisiti {"text":""}`],
      shown: "Nessun testo in questa lingua.",
      status: "Sezione «Prerequisiti» svuotata.",
    });
  });

  it("is left as it was on Annulla, with nothing sent", async () => {
    const { unmount } = open(true);
    await settle();
    await press("Modifica · Prerequisiti");
    type(section("Prerequisiti")?.querySelector("textarea"), "Altro testo.");
    await press("Annulla");
    const seen = [writes.length, text(section("Prerequisiti")?.querySelector("p"))];
    unmount();

    expect(seen).toEqual([0, "Fisica I."]);
  });

  it("keeps a section half written while another is saved, whatever a later read gives", async () => {
    const { unmount } = open(true);
    await settle();
    await press("Scrivi · Contenuti");
    type(section("Contenuti")?.querySelector("textarea"), "Campo elettrico.");
    await press("Modifica · Prerequisiti");
    type(section("Prerequisiti")?.querySelector("textarea"), "Fisica I e Analisi I.");
    unreadable = true;
    await press("Salva");
    const seen = [
      section("Contenuti")?.querySelector("textarea")?.value,
      text(section("Prerequisiti")?.querySelector("p")),
    ];
    unmount();

    expect(seen).toEqual(["Campo elettrico.", "Fisica I e Analisi I."]);
  });

  it("keeps its box open on an Escape that ends a word being composed", async () => {
    const { unmount } = open(true);
    await settle();
    await press("Modifica · Prerequisiti");
    const area = section("Prerequisiti")?.querySelector("textarea");
    act(() => {
      area?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Escape", isComposing: true, bubbles: true }),
      );
    });
    const composing = section("Prerequisiti")?.querySelector("textarea") !== null;
    act(() => {
      area?.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    });
    const seen = [composing, section("Prerequisiti")?.querySelector("textarea") ?? null];
    unmount();

    expect(seen).toEqual([true, null]);
  });

  it("offers an empty section to be written", async () => {
    const { unmount } = open(true);
    await settle();
    const seen = [
      text(section("Contenuti")?.querySelector("p")),
      button("Scrivi · Contenuti") !== undefined,
    ];
    unmount();

    expect(seen).toEqual(["Nessun testo in questa lingua.", true]);
  });
});

describe("the reading list", () => {
  it("adds a book with an empty year as none", async () => {
    const { unmount } = open(true);
    await settle();
    await press("Aggiungi testo");
    type(field("Titolo"), "Elettromagnetismo");
    type(field("Autori"), "Griffiths");
    await press("Salva");
    const seen = [writes, [...document.body.querySelectorAll("tbody tr")].length];
    unmount();

    expect(seen).toEqual([
      [
        `POST ${BASE}/readings {"title":"Elettromagnetismo","authors":"Griffiths","year":null,"isbn":"","url":"","importance":"required","locale":"it"}`,
      ],
      2,
    ]);
  });

  it("changes a book by the fields edited alone, so another's change to the rest stands", async () => {
    const { unmount } = open(true);
    await settle();
    await press("Modifica · Fisica II");
    type(field("Anno (facoltativo)"), "2022");
    await press("Salva");
    const seen = [[...writes], text(document.body.querySelector("tbody tr td:nth-child(3)"))];
    unmount();

    expect(seen).toEqual([[`PATCH ${BASE}/readings/21 {"year":"2022"}`], "2022"]);
  });

  it("shows a title the list already holds under its field, the dialog kept open", async () => {
    const { unmount } = open(true);
    await settle();
    await press("Aggiungi testo");
    type(field("Titolo"), "Fisica II");
    type(field("Autori"), "Mazzoldi");
    await press("Salva");
    const title = field("Titolo");
    const seen = {
      open: document.body.querySelector('[role="dialog"]') !== null,
      invalid: title?.getAttribute("aria-invalid"),
      error: text(document.getElementById(`${title?.id}-error`)),
      focused: document.activeElement === title,
    };
    unmount();

    expect(seen).toEqual({
      open: true,
      invalid: "true",
      error: "Questo titolo è già nell'elenco in questa lingua.",
      focused: true,
    });
  });

  it("removes a book only once the reader confirms", async () => {
    const { unmount } = open(true);
    await settle();
    await press("Rimuovi · Fisica II");
    const asked = [writes.length, text(document.body.querySelector('[role="alertdialog"] p'))];
    const confirm = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ].find((candidate) => text(candidate) === "Rimuovi");
    act(() => confirm?.click());
    await settle();
    const seen = { asked, writes: [...writes], empty: document.body.textContent };
    unmount();

    expect(seen.asked[0]).toBe(0);
    expect(seen.writes).toEqual([`DELETE ${BASE}/readings/21`]);
    expect(seen.empty).toContain("Nessun testo di riferimento.");
  });
});

it("offers no edit to a reader without the permission", async () => {
  const { unmount } = open(false);
  await settle();
  const offered = ["Modifica", "Scrivi", "Aggiungi", "Rimuovi"].filter((word) =>
    [...document.body.querySelectorAll("button")].some((b) => text(b).startsWith(word)),
  );
  const seen = [offered, text(section("Prerequisiti")?.querySelector("p"))];
  unmount();

  expect(seen).toEqual([[], "Fisica I."]);
});
