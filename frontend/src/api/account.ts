/**
 * `/api/auth/` — who is calling, and how they say so.
 *
 * `GET /api/auth/me` is the first call the application makes, and it does two
 * jobs at once: it answers "is anybody signed in" and it issues the CSRF cookie
 * every later write needs. Nothing else hands that cookie out, because in
 * development the page is served by Vite and never passes through a Django
 * template.
 */

import type { UiLocale } from "@/i18n";
import { request } from "./http";

export interface Account {
  id: number;
  username: string;
  /** Django's spelling — `it`, `en`, `zh-hans` — which is also the interface language. */
  locale: UiLocale;
}

/** `authenticated: false` is an ordinary 200, not an error. */
export interface Session {
  authenticated: boolean;
  user: Account | null;
}

export function readSession(): Promise<Session> {
  return request<Session>("/api/auth/me");
}

export function logIn(username: string, password: string): Promise<Session> {
  return request<Session>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
}

export function register(username: string, password: string, locale: UiLocale): Promise<Session> {
  return request<Session>("/api/auth/register", {
    method: "POST",
    body: JSON.stringify({ username, password, locale }),
  });
}

export function logOut(): Promise<void> {
  return request<void>("/api/auth/logout", { method: "POST" });
}

export function setAccountLocale(locale: UiLocale): Promise<Session> {
  return request<Session>("/api/auth/me", {
    method: "PATCH",
    body: JSON.stringify({ locale }),
  });
}
