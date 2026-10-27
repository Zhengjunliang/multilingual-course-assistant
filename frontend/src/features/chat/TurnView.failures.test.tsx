// @vitest-environment jsdom

/**
 * An answer that stopped says why in the interface's language, whatever the
 * browser and the server speak (#186). The banner finds its sentence by the
 * error's code, so the server's message — here the sentence of the browser's
 * language — never reaches the reader; a change of language rewords a banner
 * already on screen; and a failure the reader can only report shows its code
 * and request id, where one they can act on shows the reason alone.
 */

import { act } from "react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it } from "vitest";

import type { ErrorCode, ErrorData } from "@/api/errors";
import { ApiError, failureOf, failureOfEvent } from "@/api/http";
import i18n, { UI_LOCALES, type UiLocale } from "@/i18n";
import type { Sentence } from "@/lib/errorText";
import { mount } from "@/test/mount";
import { TurnView } from "./TurnView";
import type { Turn } from "./useAsk";

const ID = "4bf92f3577b34da6a3ce929d0e0e4736";

/** The browser's language, which the server's message follows: never the page's. */
const BROWSER: Record<UiLocale, UiLocale> = { it: "en", en: "zh-hans", "zh-hans": "it" };

/** The coded body's `error`, its message in the browser's language. */
function body(code: ErrorCode, message: string, data: ErrorData = {}) {
  return { code, message, data, fields: [], request_id: ID };
}

/** A 503 before the stream, read as `ask()` reads it. */
function refused(code: ErrorCode, message: string, data: ErrorData = {}) {
  const text = JSON.stringify({ error: body(code, message, data) });
  return failureOf(new Response(text, { status: 503, headers: { "X-Request-ID": ID } }));
}

interface Case {
  failure: string;
  /** The error the chat holds, given the server's message where there is a server. */
  error: (message: string) => ApiError | Promise<ApiError>;
  key: string;
  values: ErrorData;
  /** The code and id under a failure to report; `null` under one to act on. */
  reference: Sentence | null;
}

const withId = (code: string): Sentence => ({
  key: "errors.reference.withId",
  values: { code, id: ID },
});

const CASES: Case[] = [
  {
    failure: "an engine that stopped inside the stream",
    error: (message) => failureOfEvent({ error: body("ENGINE_DOWN", message) }, ID),
    key: "errors.ENGINE_DOWN",
    values: {},
    reference: withId("ENGINE_DOWN"),
  },
  {
    failure: "an engine that is down",
    error: (message) => refused("ENGINE_DOWN", message),
    key: "errors.ENGINE_DOWN",
    values: {},
    reference: withId("ENGINE_DOWN"),
  },
  {
    failure: "an engine still busy after the last retry",
    error: (message) => refused("UNAVAILABLE", message, { retry_after_seconds: 30 }),
    key: "errors.UNAVAILABLE",
    values: { retry_after_seconds: 30 },
    reference: null,
  },
  {
    failure: "a request that never reached the server",
    error: () => new ApiError({ status: 0, code: "NETWORK" }),
    key: "errors.NETWORK",
    values: {},
    reference: { key: "errors.reference.codeOnly", values: { code: "NETWORK" } },
  },
  {
    failure: "a stream that stopped before its end",
    error: () => new ApiError({ status: 200, code: "STREAM_INTERRUPTED", requestId: ID }),
    key: "errors.STREAM_INTERRUPTED",
    values: {},
    reference: withId("STREAM_INTERRUPTED"),
  },
];

function failed(error: ApiError): Turn {
  return {
    key: "t1",
    question: "Quando scadono le tasse?",
    answer: "",
    citations: [],
    route: null,
    searchMs: null,
    locale: "it",
    complete: false,
    failure: { kind: "failed", error },
  };
}

/** A visitor's turn, so the banner promises nothing kept and holds only the failure. */
function shown(error: ApiError) {
  return mount(
    <MemoryRouter>
      <TurnView turn={failed(error)} live={false} thinking={false} retry={null} visitor />
    </MemoryRouter>,
  );
}

const bannerText = (container: HTMLElement) => container.querySelector(".bg-warn")?.textContent;

afterEach(async () => {
  await act(() => i18n.changeLanguage("it"));
});

describe.each(UI_LOCALES)("an answer that stopped, in the %s interface", (locale) => {
  it.each(CASES)("reads $failure in the interface's words", async (case_) => {
    const t = i18n.getFixedT(locale);
    const message = i18n.getFixedT(BROWSER[locale])(case_.key, case_.values);
    const error = await case_.error(message);
    await act(() => i18n.changeLanguage(locale));

    const { container, unmount } = shown(error);
    const text = bannerText(container);
    unmount();

    const reference =
      case_.reference === null ? "" : t(case_.reference.key, case_.reference.values);
    expect(text).toBe(`${t(case_.key, case_.values)}${reference}`);
    expect(text).not.toContain(message);
  });
});

it("rewords a banner on screen when the interface changes language", async () => {
  const error = failureOfEvent({ error: body("ENGINE_DOWN", "The engine is down.") }, ID);

  const { container, unmount } = shown(error);
  const before = bannerText(container);
  await act(() => i18n.changeLanguage("en"));
  const after = bannerText(container);
  unmount();

  const en = i18n.getFixedT("en");
  expect([before, after]).toEqual([
    `Il servizio delle risposte non è disponibile. Riprova più tardi.ENGINE_DOWN · rif. ${ID}`,
    `${en("errors.ENGINE_DOWN")}${en("errors.reference.withId", { code: "ENGINE_DOWN", id: ID })}`,
  ]);
});
