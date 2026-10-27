// @vitest-environment jsdom

/**
 * An edition's reading list, read and written as its page does: what each
 * write sends, the language a book is written in, and what asks first.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { BASE, field, open, press, serve, server, settle, text, type, unserve } from "./harness";

beforeEach(serve);
afterEach(unserve);

describe("the reading list", () => {
  it("adds a book with an empty year as none, in the syllabus's language", async () => {
    const { unmount } = open(true);
    await settle();
    await press("Aggiungi testo");
    type(field("Titolo"), "Elettromagnetismo");
    type(field("Autori"), "Griffiths");
    await press("Salva");
    const seen = [server.writes, [...document.body.querySelectorAll("tbody tr")].length];
    unmount();

    expect(seen).toEqual([
      [
        `POST ${BASE}/readings {"title":"Elettromagnetismo","authors":"Griffiths","year":null,"isbn":"","url":"","importance":"required","locale":"it"}`,
      ],
      2,
    ]);
  });

  it("names a book's language in the interface's language, every one in its order in the form, and on the row under its title and authors", async () => {
    const { unmount } = open(true);
    await settle();
    await press("Aggiungi testo");
    const select = field("Lingua") as unknown as HTMLSelectElement | null;
    const names = [...(select?.options ?? [])].map((option) => option.text);
    type(select, "de");
    type(field("Titolo"), "Physik");
    type(field("Autori"), "Demtröder");
    await press("Salva");
    const added = document.body.querySelector("tbody tr:last-child");
    const seen = {
      count: names.length,
      sorted: names.slice(0, 3),
      german: names.includes("Tedesco"),
      sent: JSON.parse(server.writes[0]?.split(" ").slice(2).join(" ") ?? "{}").locale,
      row: [
        ...[...(added?.querySelectorAll("td:first-child span") ?? [])].map((span) => text(span)),
        text(added?.querySelector("td:nth-child(4)")),
      ],
    };
    unmount();

    expect(seen).toEqual({
      count: 99,
      sorted: ["Afrikaans", "Albanese", "Alto sorabo"],
      german: true,
      sent: "de",
      row: ["Physik", "Demtröder", "Tedesco"],
    });
  });

  it("changes a book by the fields edited alone, so another's change to the rest stands", async () => {
    const { unmount } = open(true);
    await settle();
    await press("Modifica · Fisica II");
    type(field("Anno (facoltativo)"), "2022");
    await press("Salva");
    const seen = [
      [...server.writes],
      text(document.body.querySelector("tbody tr td:nth-child(2)")),
    ];
    unmount();

    expect(seen).toEqual([[`PATCH ${BASE}/readings/21 {"year":"2022"}`], "2022"]);
  });

  it.each([
    ["the staff envelope", false],
    ["the coded body", true],
  ])(
    "shows a title the list already holds, refused in %s, under its field, the dialog kept open",
    async (_, coded) => {
      server.coded = coded;
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
        error: "Questo titolo è già nell'elenco.",
        focused: true,
      });
    },
  );

  it("removes a book only once the reader confirms", async () => {
    const { unmount } = open(true);
    await settle();
    await press("Rimuovi · Fisica II");
    const asked = [
      server.writes.length,
      text(document.body.querySelector('[role="alertdialog"] p')),
    ];
    const confirm = [
      ...document.body.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button'),
    ].find((candidate) => text(candidate) === "Rimuovi");
    act(() => confirm?.click());
    await settle();
    const seen = { asked, writes: [...server.writes], empty: document.body.textContent };
    unmount();

    expect(seen.asked[0]).toBe(0);
    expect(seen.writes).toEqual([`DELETE ${BASE}/readings/21`]);
    expect(seen.empty).toContain("Nessun testo di riferimento.");
  });
});
