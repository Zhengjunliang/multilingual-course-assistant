/**
 * Signing in and out against the real session (apps/accounts/views.py), each
 * test in an account it makes for itself, and an account's whole life: an
 * invitation (apps/roles/invitations.py), its devices and the superuser who
 * switches it off (apps/accounts/services.py).
 */

import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import it from "../src/i18n/it.json" with { type: "json" };
import { ADMIN, ask, logIn, newAccount, PASSWORD } from "./stack";

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

test("an invited teacher ends their other device, and the superuser switches the account off", async ({
  page,
  browser,
}) => {
  // The superuser's invitation to teach Sistemi operativi in 2026-2027.
  const admin = await browser.newContext({ storageState: ADMIN });
  const office = await admin.newPage();
  await office.goto("/staff/courses/B003370");
  await office.getByRole("link", { name: "2026-2027" }).click();
  await office.getByRole("button", { name: it.staff.invitations.teacher }).click();
  const invitation = await office.getByRole("dialog").getByLabel(it.staff.link.label).inputValue();

  // The first device makes the account the link offers, and lands on the edition.
  const username = `j-${randomUUID().slice(0, 8)}`;
  await page.goto(invitation);
  await page.getByLabel(it.auth.username).fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: it.auth.acceptAndRegister }).click();
  await expect(page).toHaveURL(/\/staff\/editions\/\d+$/);
  await expect(page.getByRole("heading", { name: "SISTEMI OPERATIVI" })).toBeVisible();

  // A second device signs in to the same account.
  const other = await browser.newContext();
  const laptop = await other.newPage();
  await logIn(laptop, username);
  await laptop.goto("/staff/mine?show=all");
  const taught = laptop.getByRole("link", { name: "SISTEMI OPERATIVI · 2026-2027" });
  await expect(taught).toBeVisible();

  // The first device ends every other one from the account's own page.
  await page.getByRole("button", { name: new RegExp(username) }).click();
  await page.getByRole("menuitem", { name: it.account.page }).click();
  await page.getByRole("button", { name: it.account.sessions.endOthers }).click();
  await page.locator("#reauth-password").fill(PASSWORD);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: it.account.sessions.end, exact: true })
    .click();
  await expect(page.getByText(it.account.sessions.endedOthers)).toBeVisible();
  // The second device's next request is refused, and the page sends it to sign in.
  await taught.click();
  await expect(laptop).toHaveURL(/\/login$/);

  // The superuser switches the account off, which ends the first device's session too.
  await office.goto("/staff/users");
  await office.getByLabel(it.staff.users.searchLabel).fill(username);
  await office
    .getByRole("button", { name: it.staff.users.actions.replace("{{username}}", username) })
    .click();
  await office.getByRole("menuitem", { name: it.staff.users.deactivate.action }).click();
  await office
    .getByRole("alertdialog")
    .getByRole("button", { name: it.staff.users.deactivate.action })
    .click();
  await expect(office.getByText(it.staff.users.deactivate.done)).toBeVisible();
  await page.getByRole("link", { name: "SISTEMI OPERATIVI · 2026-2027" }).click();
  await expect(page).toHaveURL(/\/login$/);

  await Promise.all([admin.close(), other.close()]);
});
