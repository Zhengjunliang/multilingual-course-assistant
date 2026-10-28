/**
 * What the journeys share: the one password, the fake model's answer `ask`
 * waits for, and the two ways a test gets an account. The demo's are seeded by
 * tests/journeys/serve.py and signed in once (auth.setup.ts); a test that
 * logs out registers one of its own instead, because logging out ends the
 * session the saved sign-in hands every other test.
 */

import { randomUUID } from "node:crypto";
import { fileURLToPath } from "node:url";
import { expect, type Page, request } from "@playwright/test";
import it from "../src/i18n/it.json" with { type: "json" };

/** `DEMO_PASSWORD` for the seeded accounts, and every registered one's. */
export const PASSWORD = "journeys-only-password";

/** Where auth.setup.ts saves each demo account's session (gitignored). */
export const STUDENT = fileURLToPath(new URL(".auth/student.json", import.meta.url));
export const SECRETARIAT = fileURLToPath(new URL(".auth/secretariat.json", import.meta.url));

/** What tests/journeys/fake_llm.py answers every question with, up to its citation. */
const ANSWER ="Lo sportello della segreteria è aperto il martedì";

/** The page that answer cites, which tests/journeys/retrieval.py indexes. */
export const PAGE = "https://ingegneria.unifi.it/vp-185.html";

/** Registers a new account through the API, as the register page does, and names it. */
export async function newAccount(baseURL: string): Promise<string> {
  // Empty, not inherited: inside a test this context takes the project's
  // `storageState`, and registering in a session signs it over to the new
  // account, which would end the saved demo one for every other test.
  const api = await request.newContext({ baseURL, storageState: { cookies: [], origins: [] } });
  // Any read hands out the CSRF cookie the write below must echo.
  await api.get("/api/auth/me");
  const { cookies } = await api.storageState();
  const token = cookies.find((cookie) => cookie.name === "csrftoken")?.value ?? "";
  const username = `j-${randomUUID().slice(0, 8)}`;
  const response = await api.post("/api/auth/register", {
    headers: { "X-CSRFToken": token },
    data: { username, password: PASSWORD, locale: "it" },
  });
  expect(response.status(), await response.text()).toBe(201);
  await api.dispose();
  return username;
}

/** Asks from the question box of the page at hand, and waits for the whole answer. */
export async function ask(page: Page, question: string): Promise<void> {
  await page.getByLabel(it.ask.label).fill(question);
  await page.getByRole("button", { name: it.ask.submit }).click();
  // Not the interface's five seconds: the run's first question builds the
  // engine (apps/qa/engine.py), about three seconds idle and more under load,
  // and a question asked meanwhile waits for it.
  await expect(page.getByText(ANSWER)).toBeVisible({ timeout: 15_000 });
}

/** Signs in from the login page, and waits until the page has moved on. */
export async function logIn(page: Page, username: string): Promise<void> {
  await page.goto("/login");
  await page.getByLabel(it.auth.username).fill(username);
  await page.locator("#password").fill(PASSWORD);
  await page.getByRole("button", { name: it.auth.logIn }).click();
  await page.waitForURL((url) => url.pathname !== "/login");
}
