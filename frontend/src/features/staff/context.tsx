/**
 * What every staff page shares: a loader for the page's data, and the one way
 * a refusal becomes a sentence.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { useSession } from "@/auth/useSession";
import { errorKey, isSessionLost } from "./errors";

/**
 * The sentence for a refusal, for an event handler to show. A lost session is
 * forgotten on the spot, and `RequireSession` sends the reader to sign in.
 */
export function useFailure(): (error: unknown) => string {
  const { t } = useTranslation();
  const { forget } = useSession();
  return useCallback(
    (error: unknown) => {
      if (isSessionLost(error)) forget();
      return t(errorKey(error));
    },
    [forget, t],
  );
}

interface Loaded<T> {
  data: T | null;
  error: unknown;
  /**
   * Reads again, keeping what is shown until the answer arrives, and resolves
   * once it is shown, to whether the page could be read: a dialog closes after
   * the page holds the change, so the focus it hands back lands on what is
   * there, and it can tell an object gone from the page from the page gone.
   */
  reload: () => Promise<boolean>;
}

/** `load`'s answer, read when the page opens and again on `reload()`; `load` must be stable. */
export function useLoad<T>(load: () => Promise<T>): Loaded<T> {
  const { forget } = useSession();
  const [state, setState] = useState<{ data: T | null; error: unknown }>({
    data: null,
    error: null,
  });
  // Only the latest read is shown: an answer that arrives after the page moved
  // on to another object, or after a later read, is dropped.
  const latest = useRef(0);
  const read = useCallback(() => {
    latest.current += 1;
    const mine = latest.current;
    return load().then(
      (data) => {
        if (latest.current !== mine) return false;
        setState({ data, error: null });
        return true;
      },
      (error: unknown) => {
        if (latest.current !== mine) return false;
        if (isSessionLost(error)) forget();
        setState({ data: null, error });
        return false;
      },
    );
  }, [load, forget]);

  useEffect(() => {
    // Another object's page shows nothing of the last one while it is read:
    // the same page, reached again for another id through the history.
    setState((shown) =>
      shown.data === null && shown.error === null ? shown : { data: null, error: null },
    );
    void read();
    return () => {
      latest.current += 1;
    };
  }, [read]);

  return { ...state, reload: read };
}
