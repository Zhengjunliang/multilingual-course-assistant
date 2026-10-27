/**
 * What a screen reader is told about the turn being answered: the words of
 * its banner, once, as it happens.
 */

import { describe, expect, it } from "vitest";

import { ApiError } from "@/api/http";
import i18n from "@/i18n";
import { spokenNotice } from "./notice";
import type { Turn } from "./useAsk";

const t = i18n.t;
const ID = "4bf92f3577b34da6a3ce929d0e0e4736";

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

const cut = turn({
  failure: {
    kind: "failed",
    error: new ApiError({ status: 200, code: "STREAM_INTERRUPTED", requestId: ID }),
  },
});
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

  it("says a refusal in the interface's words for its code", () => {
    const error = new ApiError({ status: 503, code: "ENGINE_DOWN", requestId: ID });
    const refused = turn({ answer: "", failure: { kind: "failed", error } });

    expect(spokenNotice(refused, null, true, false, t)).toBe(
      "Il servizio delle risposte non è disponibile. Riprova più tardi.",
    );
  });

  it("says nothing of a failure read back with a stored conversation", () => {
    const stored = turn({ failure: { kind: "interrupted" } });

    expect(spokenNotice(stored, null, false, false, t)).toBe("");
  });
});
