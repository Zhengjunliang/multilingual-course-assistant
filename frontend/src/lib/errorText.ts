/**
 * A failed request, read into the sentences a page shows (#186).
 *
 * Each sentence is a catalogue key and the values it fills in; the page renders
 * it with its own `t()`, so an error reads in the interface's language whatever
 * the browser or the server speaks, and a language switch rewords one already
 * on screen. The server's English `message` is never among them.
 *
 * An error the reader can act on gets its sentence alone. One they cannot —
 * a `failure` code (api/errors.ts), a field the page has no input for, a
 * sentence whose values did not arrive — adds a reference: the code and the
 * request id, which finds the server's log line for it.
 */

import {
  ERROR_CODES,
  type ErrorData,
  FIELD_OVERRIDES,
  FIELD_REASONS,
  type FieldReason,
  LOCAL_CODES,
  type LocalCode,
} from "@/api/errors";
import { type ApiCode, ApiError, type Violation } from "@/api/http";

/** A catalogue key and the values it fills in, for `t(key, values)`. */
export interface Sentence {
  key: string;
  values: ErrorData;
}

export interface ErrorText {
  /** For the request as a whole. */
  sentence: Sentence;
  /** For each refused field among `shownFields`, by its name, in the server's order. */
  fieldSentences: Record<string, Sentence[]>;
  /** The code and the request id, for an error the reader can only report; null otherwise. */
  reference: Sentence | null;
}

export interface DescribeOptions {
  /** The fields the page has an input for, so a sentence beside them can help. */
  shownFields?: readonly string[];
}

function isLocal(code: ApiCode): code is LocalCode {
  return (LOCAL_CODES as readonly string[]).includes(code);
}

function fills(keys: readonly string[], data: ErrorData): boolean {
  return keys.every((key) => data[key] !== undefined);
}

function hasOverride(field: string, reason: FieldReason): boolean {
  const reasons: Partial<Record<string, readonly FieldReason[]>> = FIELD_OVERRIDES;
  return reasons[field]?.includes(reason) ?? false;
}

/**
 * Transitional (#186): the server's own sentence, for a body that gave no code;
 * `errors.legacy` shows its value as it is.
 */
function legacy(text: string): Sentence {
  return { key: "errors.legacy", values: { text } };
}

/** A field's sentence: its own words when `FIELD_OVERRIDES` lists them, else the reason's. */
function fieldSentence({ field, reason, data, legacyText }: Violation): Sentence {
  if (legacyText !== undefined) return legacy(legacyText);
  const filled = fills(FIELD_REASONS[reason].dataKeys, data);
  const shown = filled ? reason : "INVALID";
  const values = filled ? data : {};
  return field !== null && hasOverride(field, shown)
    ? { key: `errors.field.${field}.${shown}`, values }
    : { key: `errors.field.${shown}`, values };
}

function referenceOf(code: ApiCode, requestId: string | null): Sentence {
  return requestId === null
    ? { key: "errors.reference.codeOnly", values: { code } }
    : { key: "errors.reference.withId", values: { code, id: requestId } };
}

/**
 * What a page shows for `error`. Anything that is not an `ApiError` threw
 * before an answer arrived: the network, as far as the reader can tell.
 */
export function describeError(
  error: unknown,
  { shownFields = [] }: DescribeOptions = {},
): ErrorText {
  if (!(error instanceof ApiError)) {
    return {
      sentence: { key: "errors.NETWORK", values: {} },
      fieldSentences: {},
      reference: referenceOf("NETWORK", null),
    };
  }

  const { code, data, requestId } = error;
  const fieldSentences: Record<string, Sentence[]> = {};
  let whole: Sentence | undefined;
  let unshown = false;
  for (const violation of error.violations) {
    const { field } = violation;
    if (field === null) whole ??= fieldSentence(violation);
    else if (shownFields.includes(field))
      fieldSentences[field] = [...(fieldSentences[field] ?? []), fieldSentence(violation)];
    else unshown = true;
  }

  const filled = isLocal(code) || fills(ERROR_CODES[code].dataKeys, data);
  const failure = isLocal(code) || ERROR_CODES[code].kind === "failure" || unshown || !filled;
  const own: Sentence =
    filled && !unshown
      ? { key: `errors.${code}`, values: data }
      : { key: "errors.INTERNAL", values: {} };
  return {
    sentence: error.legacyText === null ? (whole ?? own) : legacy(error.legacyText),
    fieldSentences,
    reference: failure ? referenceOf(code, requestId) : null,
  };
}
