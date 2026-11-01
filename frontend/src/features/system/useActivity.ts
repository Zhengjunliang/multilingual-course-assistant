/**
 * The superuser's feed of background work, read for as long as the system
 * page is open (api/system.ts) and folded into a `Feed` (feed.ts).
 *
 * The feed ends only when its reader may no longer read it. One that ends or
 * breaks once a snapshot was read is opened again after `REOPEN_MS`, whatever
 * broke it, a server restarted mid-demo included; its new snapshot holds what
 * the gap missed, and until then the page keeps what it drew, marked as not
 * live. A failure before the first snapshot, and a refusal at any time, since
 * the account is no longer a superuser, is the page's to show, with a button
 * that tries again. A lost session signs the reader out, as on every staff
 * page (features/staff/context.tsx).
 */

import { useCallback, useEffect, useReducer, useState } from "react";

import { ApiError, isSessionLost } from "@/api/http";
import { openActivity, readActivity } from "@/api/system";
import { useSession } from "@/auth/useSession";
import { EMPTY, type Feed, reduce } from "./feed";

/** How long a broken feed waits before it is opened again. */
export const REOPEN_MS = 5000;

/** Before the first snapshot, reading the feed, or waiting to open it again. */
export type Liveness = "opening" | "live" | "reopening";

export interface Activity {
  feed: Feed;
  liveness: Liveness;
  /** What failed before the first snapshot; `null` otherwise. */
  error: unknown;
  retry: () => void;
}

export function useActivity(): Activity {
  const { forget } = useSession();
  const [feed, dispatch] = useReducer(reduce, EMPTY);
  const [liveness, setLiveness] = useState<Liveness>("opening");
  const [error, setError] = useState<unknown>(null);
  const [attempt, setAttempt] = useState(0);

  // biome-ignore lint/correctness/useExhaustiveDependencies: `attempt` is the retry: a new one opens the feed again
  useEffect(() => {
    const controller = new AbortController();
    const { signal } = controller;
    const wait = () =>
      new Promise<void>((resolve) => {
        const timer = setTimeout(resolve, REOPEN_MS);
        const stop = () => {
          clearTimeout(timer);
          resolve();
        };
        signal.addEventListener("abort", stop, { once: true });
      });

    const read = async () => {
      let opened = false;
      while (!signal.aborted) {
        try {
          for await (const frame of readActivity(await openActivity(signal))) {
            if (frame.name === "snapshot") {
              dispatch({ type: "snapshot", snapshot: frame.data });
              opened = true;
              setLiveness("live");
            } else if (frame.name === "activity") {
              dispatch({ type: "entry", entry: frame.data, received: Date.now() });
            } else {
              dispatch({ type: "refresh", refresh: frame.data });
            }
          }
        } catch (caught) {
          if (signal.aborted) return;
          if (isSessionLost(caught)) {
            forget();
            return;
          }
          if (!opened || (caught instanceof ApiError && caught.code === "PERMISSION_DENIED")) {
            setError(caught);
            return;
          }
        }
        if (signal.aborted) return;
        setLiveness("reopening");
        await wait();
      }
    };
    void read();
    return () => controller.abort();
  }, [attempt, forget]);

  const retry = useCallback(() => {
    setError(null);
    setLiveness("opening");
    setAttempt((count) => count + 1);
  }, []);

  return { feed, liveness, error, retry };
}
