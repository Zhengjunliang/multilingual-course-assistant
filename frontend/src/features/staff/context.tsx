/**
 * What every staff page shares: a loader for the page's data, and the one way
 * a refusal becomes a sentence.
 */

import { useCallback, useEffect, useState } from "react";
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
   * once it is shown: a dialog closes after the page holds the change, so the
   * focus it hands back lands on what is there.
   */
  reload: () => Promise<void>;
}

/** `load`'s answer, read when the page opens and again on `reload()`; `load` must be stable. */
export function useLoad<T>(load: () => Promise<T>): Loaded<T> {
  const { forget } = useSession();
  const [state, setState] = useState<{ data: T | null; error: unknown }>({
    data: null,
    error: null,
  });
  const read = useCallback(
    (live: () => boolean) =>
      load().then(
        (data) => {
          if (live()) setState({ data, error: null });
        },
        (error: unknown) => {
          if (!live()) return;
          if (isSessionLost(error)) forget();
          setState({ data: null, error });
        },
      ),
    [load, forget],
  );

  // An answer that arrives after the page moved on to another object is dropped.
  useEffect(() => {
    let live = true;
    void read(() => live);
    return () => {
      live = false;
    };
  }, [read]);

  const reload = useCallback(() => read(() => true), [read]);
  return { ...state, reload };
}
