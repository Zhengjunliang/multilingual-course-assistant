/**
 * Signing in and out against the real session (apps/accounts/views.py), each
 * test in an account it registers for itself.
 */

import { expect, test } from "@playwright/test";
import it from "../src/i18n/it.json" with { type: "json" };
import { ask, logIn, newAccount } from "./stack";

test("an account signs in, and signing out ends its session on the server", async ({
  page,
  baseURL,
}) => {
  const username = await newAccount(baseURL ?? "");
  await logIn(page, username);
  const session = (await page.context().cookies()).filter(({ name }) => name === "sessionid");
  expect(session).toHaveLength(1);

  await page.getByRole("button", { name: new RegExp(username) }).click();
  await page.getByRole("menuitem", { name: it.account.logOut }).click();

  await expect(page.getByRole("link", { name: it.auth.logIn })).toBeVisible();
  // The old cookie, put back, opens nothing: the server ended the session,
  // rather than the page forgetting it.
  await page.context().addCookies(session);
  const me = await page.request.get("/api/auth/me");
  expect(await me.json()).toMatchObject({ authenticated: false });
});

test("signing out in one tab sends another tab of the same browser to sign in", async ({
  page,
  context,
  baseURL,
}) => {
  const username = await newAccount(baseURL ?? "");
  await logIn(page, username);
  // The other tab holds a conversation, an address only an account opens.
  const other = await context.newPage();
  await other.goto("/");
  await ask(other, "Quando apre la segreteria?");
  await expect(other).toHaveURL(/\/chat\/[0-9a-f-]{36}$/);

  await page.bringToFront();
  await page.getByRole("button", { name: new RegExp(username) }).click();
  await page.getByRole("menuitem", { name: it.account.logOut }).click();
  await expect(page.getByRole("link", { name: it.auth.logIn })).toBeVisible();

  // A tab learns of it when it is shown again (`visibilitychange`, which a
  // headless browser never fires: its tabs are all visible at once) or on its
  // next request, refused as a session that ended (ChatPage.tsx).
  await other.bringToFront();
  await other.getByLabel(it.ask.label).fill("E il sabato?");
  await other.getByRole("button", { name: it.ask.submit }).click();
  await expect(other).toHaveURL(/\/login$/);
});
