/**
 * A refusal as the server writes it (#186): the coded body, at the status the
 * code's row of `api/errors.ts` gives, with the request id in the body and in
 * the `X-Request-ID` header.
 */

import {
  ERROR_CODES,
  type ErrorBody,
  type ErrorCode,
  type ErrorData,
  type FieldViolation,
} from "@/api/errors";

export const REQUEST_ID = "4bf92f3577b34da6a3ce929d0e0e4736";

/** The server's English sentence, unless a test gives its own: no page may show it. */
export const SERVER_MESSAGE = "The server's own words.";

interface RefusalOptions {
  data?: ErrorData;
  fields?: FieldViolation[];
  message?: string;
}

export function codedRefusal(
  code: ErrorCode,
  { data = {}, fields = [], message = SERVER_MESSAGE }: RefusalOptions = {},
): Response {
  const error: ErrorBody = { code, message, data, fields, request_id: REQUEST_ID };
  return new Response(JSON.stringify({ error }), {
    status: ERROR_CODES[code].status,
    headers: { "Content-Type": "application/json", "X-Request-ID": REQUEST_ID },
  });
}
