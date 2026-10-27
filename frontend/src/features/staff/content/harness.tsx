/**
 * The edition page's content tabs as their tests mount them: the syllabus and
 * the reading list read as EditionPage reads them, and a server faked at
 * `fetch` that answers as apps/catalog/content_views.py does, so the bodies
 * and codes travel through `api/http.ts` as they would in the application.
 * They are a route of a data router, as the page is, with another to leave for.
 */

import type { Editor } from "@tiptap/react";
import { act, useCallback } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { vi } from "vitest";

import type { Account } from "@/api/account";
import { listReadings, type ReadingItem, type Syllabus } from "@/api/catalog";
import { SessionContext } from "@/auth/SessionProvider";
import { Toaster } from "@/components/ui/sonner";
import { mount } from "@/test/mount";
import { useLoad } from "../context";
import { ReadingList } from "./ReadingList";
import { SyllabusPanel } from "./SyllabusPanel";
import { useSyllabus } from "./syllabus";

const READER: Account = {
  id: 1,
  username: "demo-teacher",
  locale: "it",
  is_superuser: false,
  roles: [{ role: "teacher", edition: 5 }],
};
export const BASE = "/api/catalog/editions/5";

export const FISICA: ReadingItem = {
  id: 21,
  locale: "it",
  title: "Fisica II",
  authors: "Mazzoldi, Nigro, Voci",
  year: 2021,
  isbn: "",
  url: "",
  importance: "required",
};

/** What the fake server holds, set afresh before each test (`serve`). */
export const server = {
  syllabus: { locale: "it", sections: [] } as Syllabus,
  books: [] as ReadingItem[],
  /** Whether reading the syllabus fails, as a dropped connection would. */
  unreadable: false,
  /** Whether a refused book is answered in the coded body (#186), not the staff envelope. */
  coded: false,
  /** Every write that reached the server, as `METHOD path body`. */
  writes: [] as string[],
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function fakeApi(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const path = String(input);
  const method = init.method ?? "GET";
  if (method !== "GET") server.writes.push(`${method} ${path} ${init.body ?? ""}`.trim());
  if (path === `${BASE}/syllabus` && method === "GET") {
    if (server.unreadable)
      return json({ detail: { message: "Server error.", code: "error" } }, 500);
    return json(server.syllabus);
  }
  if (path === `${BASE}/syllabus` && method === "PATCH") {
    const { locale } = JSON.parse(String(init.body)) as Pick<Syllabus, "locale">;
    server.syllabus = { ...server.syllabus, locale };
    return json(server.syllabus);
  }
  const section = path.match(/\/syllabus\/([^/]+)$/);
  if (section !== null && method === "PUT") {
    const key = section[1] as Syllabus["sections"][number]["section"];
    const { text } = JSON.parse(String(init.body)) as { text: string };
    const rest = server.syllabus.sections.filter((row) => row.section !== key);
    if (text.trim() === "") {
      server.syllabus = { ...server.syllabus, sections: rest };
      return new Response(null, { status: 204 });
    }
    server.syllabus = { ...server.syllabus, sections: [...rest, { section: key, text }] };
    return json({ section: key, text });
  }
  if (path === `${BASE}/readings` && method === "GET") return json(server.books);
  if (path === `${BASE}/readings` && method === "POST") {
    const book = JSON.parse(String(init.body)) as Omit<ReadingItem, "id">;
    if (server.books.some((listed) => listed.title === book.title)) {
      if (!server.coded) {
        return json(
          { title: [{ message: "This title is already on the list.", code: "unique" }] },
          400,
        );
      }
      const fields = [{ field: "title", reason: "ALREADY_EXISTS", data: {} }];
      const id = "0".repeat(32);
      return json(
        { error: { code: "INVALID_ARGUMENT", message: "…", data: {}, fields, request_id: id } },
        400,
      );
    }
    const added = { ...book, id: 30, year: book.year === null ? null : Number(book.year) };
    server.books = [...server.books, added];
    return json(added, 201);
  }
  const one = path.match(/\/readings\/(\d+)$/);
  if (one !== null && method === "PATCH") {
    const changes = JSON.parse(String(init.body)) as Partial<ReadingItem>;
    server.books = server.books.map((book) =>
      book.id === Number(one[1]) ? { ...book, ...changes } : book,
    );
    return json(server.books.find((book) => book.id === Number(one[1])));
  }
  if (one !== null && method === "DELETE") {
    server.books = server.books.filter((book) => book.id !== Number(one[1]));
    return new Response(null, { status: 204 });
  }
  return json({ detail: { message: "Not found.", code: "not_found" } }, 404);
}

/** Starts each test from one Italian section, Prerequisiti, and one book. */
export function serve() {
  server.syllabus = { locale: "it", sections: [{ section: "prerequisiti", text: "Fisica I." }] };
  server.books = [FISICA];
  server.unreadable = false;
  server.coded = false;
  server.writes.length = 0;
  vi.stubGlobal("fetch", fakeApi);
}

export function unserve() {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
}

/** The two tabs' panels, read as EditionPage reads them. */
function Content({ editable }: { editable: boolean }) {
  const syllabus = useSyllabus(5);
  const load = useCallback(() => listReadings(5), []);
  const books = useLoad(load);
  return (
    <main>
      <h1 tabIndex={-1}>FISICA II</h1>
      <SyllabusPanel
        edition={5}
        syllabus={syllabus}
        editable={editable}
        reloadPage={async () => true}
      />
      <ReadingList
        edition={5}
        books={books}
        language={syllabus.locale ?? "it"}
        editable={editable}
        reloadPage={async () => true}
      />
    </main>
  );
}

export function open(editable: boolean) {
  const router = createMemoryRouter([
    { path: "/", element: <Content editable={editable} /> },
    { path: "/away", element: <main>Altrove</main> },
  ]);
  const mounted = mount(
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
      <RouterProvider router={router} />
      <Toaster />
    </SessionContext>,
  );
  return { ...mounted, router };
}

export async function settle() {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** What a screen reader reads of `element`: its text without the parts hidden from it. */
export function text(element: Element | null | undefined): string {
  if (!element) return "";
  const copy = element.cloneNode(true) as Element;
  for (const hidden of copy.querySelectorAll("[aria-hidden]")) hidden.remove();
  return copy.textContent?.trim() ?? "";
}

/** The first button a screen reader names `label`. */
export function button(label: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => text(candidate) === label,
  );
}

export async function press(label: string) {
  act(() => {
    // A pointer press moves focus to the button, which jsdom's click does not.
    button(label)?.focus();
    button(label)?.click();
  });
  await settle();
}

export function type(
  field: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement | null | undefined,
  value: string,
) {
  const prototype =
    field instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement
      : field instanceof HTMLSelectElement
        ? HTMLSelectElement
        : HTMLInputElement;
  const setter = Object.getOwnPropertyDescriptor(prototype.prototype, "value")?.set;
  act(() => {
    setter?.call(field, value);
    field?.dispatchEvent(
      new Event(field instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }),
    );
  });
}

/** The input a visible label names. */
export function field(label: string) {
  const tag = [...document.body.querySelectorAll("label")].find((l) => l.textContent === label);
  return document.getElementById(tag?.htmlFor ?? "") as HTMLInputElement | null;
}

/** The tab a screen reader names `name`, its caption aside. */
export function tab(name: string) {
  return [...document.body.querySelectorAll<HTMLElement>('[role="tab"]')].find(
    (candidate) => text(candidate.querySelector("span > span")) === name,
  );
}

/** Shows a section, as a press on its tab does: Radix's trigger answers the mousedown. */
export async function show(name: string) {
  act(() => {
    tab(name)?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
  await settle();
}

/** The panel of the section named `name`, shown or not. */
export function panel(name: string) {
  return [...document.body.querySelectorAll('[role="tabpanel"]')].find(
    (candidate) => candidate.querySelector("h2")?.textContent === name,
  );
}

export const status = () => text(document.body.querySelector('[role="status"]'));

/** The editor a section's box holds, once its chunk has loaded. */
export function editorIn(name: string): Editor | undefined {
  const text = panel(name)?.querySelector<HTMLElement & { editor?: Editor }>(
    '[contenteditable="true"]',
  );
  return text?.editor;
}

/** Opens a section's box with `label` and waits for the editor's chunk. */
export async function openEditor(name: string, label: string) {
  await press(`${label} · ${name}`);
  for (let turn = 0; turn < 50 && editorIn(name) === undefined; turn += 1) await settle();
}

/** Replaces a section's text in its editor, as typing it would. */
export function write(name: string, markdown: string) {
  act(() => {
    editorIn(name)?.commands.setContent(markdown, { contentType: "markdown", emitUpdate: true });
  });
}

/** A key pressed in a section's text. */
export function key(name: string, init: KeyboardEventInit, keyCode?: number) {
  const event = new KeyboardEvent("keydown", { bubbles: true, cancelable: true, ...init });
  if (keyCode !== undefined) Object.defineProperty(event, "keyCode", { value: keyCode });
  act(() => {
    panel(name)?.querySelector('[contenteditable="true"]')?.dispatchEvent(event);
  });
}
