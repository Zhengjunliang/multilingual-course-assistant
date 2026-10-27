/**
 * A failed request, read into catalogue sentences: the reader's own fix where
 * there is one, the code and the request id where there is not (#186).
 */

import { describe, expect, it } from "vitest";

import { ApiError } from "@/api/http";
import i18n from "@/i18n";
import { describeError } from "./errorText";

const ID = "4bf92f3577b34da6a3ce929d0e0e4736";
const WITH_ID = (code: string) => ({
  key: "errors.reference.withId",
  values: { code, id: ID },
});

describe("describeError", () => {
  it("gives an error the reader can act on its sentence alone, with its values", () => {
    const error = new ApiError({
      status: 429,
      code: "RESOURCE_EXHAUSTED",
      data: { retry_after_seconds: 30 },
      requestId: ID,
    });

    expect(describeError(error)).toEqual({
      sentence: { key: "errors.RESOURCE_EXHAUSTED", values: { retry_after_seconds: 30 } },
      fieldSentences: {},
      reference: null,
    });
  });

  it("adds the code and the request id under an error the reader can only report", () => {
    const error = new ApiError({ status: 503, code: "ENGINE_DOWN", requestId: ID });

    expect(describeError(error)).toEqual({
      sentence: { key: "errors.ENGINE_DOWN", values: {} },
      fieldSentences: {},
      reference: WITH_ID("ENGINE_DOWN"),
    });
  });

  it("reads anything that is not the server's answer as the network, with no request id", () => {
    expect(describeError(new TypeError("Failed to fetch"))).toEqual({
      sentence: { key: "errors.NETWORK", values: {} },
      fieldSentences: {},
      reference: { key: "errors.reference.codeOnly", values: { code: "NETWORK" } },
    });
  });

  it("puts each shown field's sentence beside it, in a field's own words where it has them", () => {
    const error = new ApiError({
      status: 400,
      code: "INVALID_ARGUMENT",
      violations: [
        { field: "username", reason: "ALREADY_EXISTS", data: {} },
        { field: "password", reason: "TOO_SHORT", data: { min_length: 8 } },
        { field: "password", reason: "TOO_COMMON", data: {} },
      ],
      requestId: ID,
    });

    expect(describeError(error, { shownFields: ["username", "password"] })).toEqual({
      sentence: { key: "errors.INVALID_ARGUMENT", values: {} },
      fieldSentences: {
        username: { key: "errors.field.username.ALREADY_EXISTS", values: {} },
        password: { key: "errors.field.TOO_SHORT", values: { min_length: 8 } },
      },
      reference: null,
    });
  });

  it("gives an error of the object as a whole as the sentence", () => {
    const error = new ApiError({
      status: 400,
      code: "INVALID_ARGUMENT",
      violations: [{ field: null, reason: "INVALID", data: {} }],
    });

    expect(describeError(error).sentence).toEqual({ key: "errors.field.INVALID", values: {} });
  });

  it("reads a refused field the page has no input for as a failure to report", () => {
    const error = new ApiError({
      status: 400,
      code: "INVALID_ARGUMENT",
      violations: [{ field: "history", reason: "INVALID", data: {} }],
      requestId: ID,
    });

    expect(describeError(error, { shownFields: ["question"] })).toEqual({
      sentence: { key: "errors.INTERNAL", values: {} },
      fieldSentences: {},
      reference: WITH_ID("INVALID_ARGUMENT"),
    });
  });

  it("never fills a sentence whose values did not arrive", () => {
    const field = new ApiError({
      status: 400,
      code: "INVALID_ARGUMENT",
      violations: [{ field: "title", reason: "TOO_LONG", data: {} }],
    });
    const whole = new ApiError({ status: 429, code: "RESOURCE_EXHAUSTED", requestId: ID });

    expect([
      describeError(field, { shownFields: ["title"] }).fieldSentences,
      describeError(whole),
    ]).toEqual([
      { title: { key: "errors.field.INVALID", values: {} } },
      {
        sentence: { key: "errors.INTERNAL", values: {} },
        fieldSentences: {},
        reference: WITH_ID("RESOURCE_EXHAUSTED"),
      },
    ]);
  });

  it("shows the server's own sentence for an old body that gave no code", () => {
    const error = new ApiError({
      status: 400,
      code: "INVALID_ARGUMENT",
      violations: [
        { field: "password", reason: "INVALID", data: {}, legacyText: "Too common." },
        { field: null, reason: "INVALID", data: {}, legacyText: "Wrong." },
      ],
    });
    const whole = new ApiError({ status: 404, code: "NOT_FOUND", legacyText: "Gone." });

    expect([
      describeError(error, { shownFields: ["password"] }),
      describeError(whole).sentence,
    ]).toEqual([
      {
        sentence: { key: "errors.legacy", values: { text: "Wrong." } },
        fieldSentences: { password: { key: "errors.legacy", values: { text: "Too common." } } },
        reference: null,
      },
      { key: "errors.legacy", values: { text: "Gone." } },
    ]);
  });

  it("reads the reference in the interface's language", async () => {
    const { reference } = describeError(
      new ApiError({ status: 503, code: "ENGINE_DOWN", requestId: ID }),
    );
    if (reference === null) throw new Error("a failure carries a reference");

    const read = [];
    for (const locale of ["it", "en", "zh-hans"]) {
      await i18n.changeLanguage(locale);
      read.push(i18n.t(reference.key, reference.values));
    }

    expect(read).toEqual([
      `ENGINE_DOWN · rif. ${ID}`,
      `ENGINE_DOWN · ref. ${ID}`,
      `ENGINE_DOWN · 编号 ${ID}`,
    ]);
  });
});
