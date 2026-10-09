/**
 * Who is signed in, asked once at startup and kept from then on.
 *
 * The first call is `GET /api/auth/me`, and it must happen before anything
 * else: it is what issues the CSRF cookie every later write needs. Until it
 * answers, the application knows nothing and renders nothing — a flash of the
 * login page in front of somebody who is already signed in is worse than a
 * moment of blank.
 *
 * The account's `locale` drives the interface, so this is also where i18next is
 * pointed at a language once a reader signs in, and where that language is
 * remembered on this screen (i18n/index.ts). `User.locale` is the single
 * source for a signed-in reader; the switch in the header writes to the
 * account and the account writes back here.
 *
 * Signing in, signing up and signing out also empty the visitor's thread
 * (features/chat/visitorThread.ts), here or in another tab (`recheck`). It is
 * not carried into the account, and a reader who signs out of a shared
 * computer leaves no thread for the next one. Only these: the first
 * `readSession` answering "nobody" is a reload, and a visitor's thread is
 * meant to survive one.
 */

import { createContext, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";

import type { Account } from "@/api/account";
import { logIn, logOut, readSession, register, setAccountLocale } from "@/api/account";
import { clearVisitorThread } from "@/features/chat/visitorThread";
import { chooseUiLocale, type UiLocale } from "@/i18n";

interface SessionValue {
  /** `null` means nobody is signed in — an ordinary state, not a failure. */
  account: Account | null;
  logIn: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, locale: UiLocale) => Promise<void>;
  logOut: () => Promise<void>;
  chooseLocale: (locale: UiLocale) => Promise<void>;
  /** Called when a request comes back refused, to drop a session that ended elsewhere. */
  forget: () => void;
  /**
   * Asks the server again who is signed in, and follows it if that changed.
   * Signing in or out in another tab shares the cookie and not this tab's
   * state; a visitor's next question would then be refused as a signed-in
   * client's (apps/qa/serializers.py). So the tab asks whenever it comes back
   * into view, as NextAuth's `refetchOnWindowFocus` does (outside the
   * repository), and a visitor's tab after each question too, for the window
   * that stayed in view while the other one signed in.
   */
  recheck: () => Promise<void>;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [account, setAccount] = useState<Account | null>(null);
  const [asked, setAsked] = useState(false);

  const adopt = useCallback((next: Account | null) => {
    setAccount(next);
    // The account's language is a choice its reader made, so it is
    // remembered on this screen too, and outlasts signing out.
    if (next !== null) void chooseUiLocale(next.locale);
  }, []);

  useEffect(() => {
    let live = true;
    readSession()
      .then((session) => {
        if (live) adopt(session.user);
      })
      .catch(() => {
        // A server that cannot even answer this is one nobody can log into.
        // Treating it as "signed out" puts the login page in front of the
        // reader, which is where the error will be shown honestly.
        if (live) adopt(null);
      })
      .finally(() => {
        if (live) setAsked(true);
      });
    return () => {
      live = false;
    };
  }, [adopt]);

  // Stable across renders on purpose: consumers put it in `useCallback`
  // dependency lists, and one that changed with every session update would
  // rebuild those callbacks — and re-run the effects that depend on them — each
  // time anything about the account changed. Switching language refetched the
  // sidebar five times before this was pulled out of the memo below.
  const forget = useCallback(() => setAccount(null), []);

  const value = useMemo<SessionValue>(
    () => ({
      account,
      logIn: async (username, password) => {
        const session = await logIn(username, password);
        clearVisitorThread();
        adopt(session.user);
      },
      register: async (username, password, locale) => {
        const session = await register(username, password, locale);
        clearVisitorThread();
        adopt(session.user);
      },
      logOut: async () => {
        await logOut();
        clearVisitorThread();
        forget();
      },
      chooseLocale: async (locale) => {
        // Applied locally first: the request is a round trip, and a language
        // switch that lags behind the click reads as a broken button. The
        // account is still the source — this only stops it looking slow.
        void chooseUiLocale(locale);
        adopt((await setAccountLocale(locale)).user);
      },
      forget,
      recheck: async () => {
        try {
          const { user } = await readSession();
          if ((user?.id ?? null) === (account?.id ?? null)) return;
          clearVisitorThread();
          adopt(user);
        } catch {
          // A server that cannot say who is signed in has nothing to follow;
          // the next request reports whatever is wrong with it.
        }
      },
    }),
    [account, adopt, forget],
  );

  const { recheck } = value;
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") void recheck();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [recheck]);

  if (!asked) return null;
  return <SessionContext value={value}>{children}</SessionContext>;
}
