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
import type { InvitationGrant } from "./catalog";
import { request } from "./http";

/**
 * Where the caller holds a staff role: an edition by its id, a programme by its
 * code. What the role allows there is answered per scope, never worked out
 * from the role name here.
 */
export type RoleScope =
  | { role: "teacher"; edition: number }
  | { role: "secretariat"; programme: string };

export interface Account {
  id: number;
  username: string;
  /** Django's spelling — `it`, `en`, `zh-hans` — which is also the interface language. */
  locale: UiLocale;
  is_superuser: boolean;
  roles: RoleScope[];
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

/**
 * A session of the account, as its own sessions page lists it. `id` names it
 * without being its cookie (apps/accounts/sessions.py); `user_agent` is the
 * browser's own string, at most 256 characters, empty when it sent none.
 */
export interface AccountSession {
  id: string;
  /** The session this request came on: listed, and ended only by signing out. */
  current: boolean;
  user_agent: string;
  ip: string | null;
  authenticated_at: string | null;
  last_activity: string | null;
}

/** Every other session of the account ends; this one stays, under a new key. */
export function changePassword(password: string, newPassword: string): Promise<void> {
  return request<void>("/api/auth/password", {
    method: "POST",
    body: JSON.stringify({ password, new_password: newPassword }),
  });
}

/** The most recently used first. */
export function listSessions(): Promise<AccountSession[]> {
  return request<AccountSession[]>("/api/auth/sessions");
}

/** Ends one session by its `id`, or with `"others"` every one but the caller's. */
export function endSessions(password: string, session: string): Promise<void> {
  return request<void>("/api/auth/sessions/end", {
    method: "POST",
    body: JSON.stringify({ password, session }),
  });
}

/** Deletes the caller's account and its conversations, and signs it out. */
export function deleteOwnAccount(password: string): Promise<void> {
  return request<void>("/api/auth/me/delete", {
    method: "POST",
    body: JSON.stringify({ password }),
  });
}

// A link's token travels in a body, never in a path a log reads
// (apps/accounts/link_views.py), so even a lookup is a `POST`.

/** The username a reset link resets; the link stays usable. */
export function lookUpResetLink(token: string): Promise<{ username: string }> {
  return request<{ username: string }>("/api/auth/reset/lookup", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

/** Sets the password and ends every session of the account; signs nobody in. */
export function resetPassword(token: string, newPassword: string): Promise<void> {
  return request<void>("/api/auth/reset", {
    method: "POST",
    body: JSON.stringify({ token, new_password: newPassword }),
  });
}

/** What the invitation makes its holder; it stays usable. */
export function lookUpInvitation(token: string): Promise<InvitationGrant> {
  return request<InvitationGrant>("/api/auth/invitation/lookup", {
    method: "POST",
    body: JSON.stringify({ token }),
  });
}

/** The account an invitation's holder makes for themselves, as registering names one. */
export interface NewAccount {
  username: string;
  password: string;
  locale: UiLocale;
}

/**
 * Accepts as the account named: the one signed in, by its `id`, or one made
 * for it and signed in. A named account that is not the one signed in is a
 * 401 `UNAUTHENTICATED`. Either way the answer is `me`'s, naming the role.
 */
export function acceptInvitation(
  token: string,
  as: { account: number } | NewAccount,
): Promise<Session> {
  return request<Session>("/api/auth/invitation/accept", {
    method: "POST",
    body: JSON.stringify({ token, ...as }),
  });
}
