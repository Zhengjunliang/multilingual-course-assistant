/**
 * The demo accounts the journeys start from, signed in once per run through
 * the login page; each saved session is handed to the tests that `use` it.
 * Neither is ever logged out: account.spec.ts registers its own.
 */

import { test as setup } from "@playwright/test";
import { logIn, SECRETARIAT, STUDENT } from "./stack";

for (const [username, path] of [
  ["demo-student", STUDENT],
  ["demo-secretariat", SECRETARIAT],
] as const) {
  setup(`sign in ${username}`, async ({ page }) => {
    await logIn(page, username);
    await page.context().storageState({ path });
  });
}
