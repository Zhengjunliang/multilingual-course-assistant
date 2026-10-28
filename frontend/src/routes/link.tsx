/**
 * The token of a link the site hands out, a reset link or an invitation
 * (apps/accounts/links.py), and what it is a link to.
 *
 * The token is the address's fragment, `/reset#<token>`, which a browser
 * never sends (RFC 3986, section 3.5, outside the repository), so no server
 * log holds it; the page sends it in a body. Opening the page looks the link
 * up, which leaves it usable. A dead link, used, expired, revoked or never
 * made, is one `LINK_EXPIRED`, the server telling none of these apart, and so
 * is an address with no token.
 */

import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { useLocation } from "react-router-dom";

import { ApiError } from "@/api/http";
import { FieldError } from "@/components/ui/field";
import { describeError, type ErrorText } from "@/lib/errorText";

export function isDeadLink(error: unknown): boolean {
  return error instanceof ApiError && error.code === "LINK_EXPIRED";
}

const DEAD: ErrorText = {
  sentence: { key: "errors.LINK_EXPIRED", values: {} },
  fieldSentences: {},
  reference: null,
};

export interface HandedLink<T> {
  token: string;
  /** What the link is to; `null` while it is looked up, and once it failed. */
  target: T | null;
  /** Why the page cannot use it; `null` while it is looked up, and while it can. */
  failure: ErrorText | null;
  /** The link died while the page held it: a send it refused. */
  died: () => void;
}

/** `lookUp` must keep its identity across renders: a module's function. */
export function useLink<T>(lookUp: (token: string) => Promise<T>): HandedLink<T> {
  const token = useLocation().hash.slice(1);
  const [state, setState] = useState<{ target: T | null; failure: ErrorText | null }>({
    target: null,
    failure: null,
  });

  useEffect(() => {
    if (token === "") {
      setState({ target: null, failure: DEAD });
      return;
    }
    let live = true;
    lookUp(token).then(
      (target) => {
        if (live) setState({ target, failure: null });
      },
      (error: unknown) => {
        if (live) setState({ target: null, failure: describeError(error) });
      },
    );
    return () => {
      live = false;
    };
  }, [token, lookUp]);

  const died = useCallback(() => setState({ target: null, failure: DEAD }), []);
  return { token, ...state, died };
}

/** Why the page cannot use its link: dead, or not looked up at all. */
export function LinkFailure({ failure }: { failure: ErrorText }) {
  const { t } = useTranslation();
  return (
    <FieldError
      role="alert"
      reference={failure.reference ? t(failure.reference.key, failure.reference.values) : undefined}
    >
      {t(failure.sentence.key, failure.sentence.values)}
    </FieldError>
  );
}
