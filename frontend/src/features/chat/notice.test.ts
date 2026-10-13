/**
 * What a screen reader is told about the turn being answered: the words of
 * its banner, once, as it happens.
 */

import { describe, expect, it } from "vitest";

import i18n from "@/i18n";
import { spokenNotice } from "./notice";
import type { Turn } from "./useAsk";

const t = i18n.t;

function turn(overrides: Partial<Turn> = {}): Turn {
  return {
    key: "t1",
    question: "Quando scadono le tasse?",
    answer: "La scadenza è",
    citations: [],
    route: null,
    searchMs: null,
    locale: "it",
    complete: false,
    failure: null,
    ...overrides,
  };
}

const cut = turn({ failure: { kind: "incomplete" } });
const heading = "La risposta si è interrotta prima della fine.";
const kept = "Quello che vedi è stato salvato così com'è.";

describe("what is said about the turn being answered", () => {
  it("is nothing while nothing has gone wrong", () => {
    expect(spokenNotice(turn(), null, false, false, t)).toBe("");
  });

  it("says how long until the next try, and which it is, while a busy server is waited out", () => {
    expect(spokenNotice(turn(), { seconds: 5, attempt: 1 }, false, false, t)).toBe(
      "C'è un'altra domanda in corso. Riprovo tra 5 secondi (1 di 2).",
    );
  });

  it("says an answer stopped just now, and that what was written is kept", () => {
    expect(spokenNotice(cut, null, true, false, t)).toBe(`${heading} ${kept}`);
  });

  it("promises nothing kept when nothing was written, or to a visitor", () => {
    expect(spokenNotice({ ...cut, answer: "" }, null, true, false, t)).toBe(heading);
    expect(spokenNotice(cut, null, true, true, t)).toBe(heading);
  });

  it("says the server's own words when it refused the question", () => {
    const refused = turn({ answer: "", failure: { kind: "reported", detail: "Server error." } });

    expect(spokenNotice(refused, null, true, false, t)).toBe("Server error.");
  });

  it("says nothing of a failure read back with a stored conversation", () => {
    expect(spokenNotice(cut, null, false, false, t)).toBe("");
  });
});
