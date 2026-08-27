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
 * pointed at a language. `User.locale` is the single source for that; the
 * switch in the header writes to the account and the account writes back here.
 */

import { createContext, type ReactNode, useCallback, useEffect, useMemo, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Account } from "@/api/account";
import { logIn, logOut, readSession, register, setAccountLocale } from "@/api/account";
import type { UiLocale } from "@/i18n";

interface SessionValue {
  /** `null` means nobody is signed in — an ordinary state, not a failure. */
  account: Account | null;
  logIn: (username: string, password: string) => Promise<void>;
  register: (username: string, password: string, locale: UiLocale) => Promise<void>;
  logOut: () => Promise<void>;
  chooseLocale: (locale: UiLocale) => Promise<void>;
  /** Called when a request comes back refused, to drop a session that ended elsewhere. */
  forget: () => void;
}

export const SessionContext = createContext<SessionValue | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const { i18n } = useTranslation();
  const [account, setAccount] = useState<Account | null>(null);
  const [asked, setAsked] = useState(false);

  const adopt = useCallback(
    (next: Account | null) => {
      setAccount(next);
      if (next !== null) void i18n.changeLanguage(next.locale);
    },
    [i18n],
  );

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

  const value = useMemo<SessionValue>(
    () => ({
      account,
      logIn: async (username, password) => adopt((await logIn(username, password)).user),
      register: async (username, password, locale) =>
        adopt((await register(username, password, locale)).user),
      logOut: async () => {
        await logOut();
        setAccount(null);
      },
      chooseLocale: async (locale) => {
        // Applied locally first: the request is a round trip, and a language
        // switch that lags behind the click reads as a broken button. The
        // account is still the source — this only stops it looking slow.
        void i18n.changeLanguage(locale);
        adopt((await setAccountLocale(locale)).user);
      },
      forget: () => setAccount(null),
    }),
    [account, adopt, i18n],
  );

  if (!asked) return null;
  return <SessionContext value={value}>{children}</SessionContext>;
}
