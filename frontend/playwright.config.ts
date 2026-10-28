import { defineConfig, devices } from "@playwright/test";

/**
 * The browser floors (#134): the built interface in a real Chromium, every
 * `/api` request answered by `e2e/api.ts`, so no Django, database or model runs.
 *
 * CI only, in the `browser` job of `.github/workflows/ci.yml`; `scripts/check.py`
 * leaves it out so the local loop stays fast. `npm run e2e` runs it by hand.
 *
 * The build goes to `dist-e2e/` with `/` as its base. The real build's base is
 * `/static/`, where Django serves it, but `vite preview` serves from `/`; and a
 * separate folder leaves `dist/`, which `runserver` serves, as the chain built it.
 * The bytes are the same apart from that prefix, which is what the budget reads.
 *
 * Built and served afresh on every run, on a port nothing else uses: 4173,
 * `vite preview`'s default, may already be serving `dist/`, and a reused server
 * would test some other build than the one the budget reads.
 */
const PORT = 4317;
const CI = process.env.CI !== undefined;

export default defineConfig({
  testDir: "e2e",
  testMatch: /\.spec\.ts$/,
  fullyParallel: true,
  forbidOnly: CI,
  // None anywhere: a retry reports a race as a pass, and a flaky test is fixed
  // or deleted (docs/testing.md, section "Flaky tests"). Measured before it was
  // set: 49 `browser` runs, 2026-10-05 to 2026-10-28, with one retry allowed,
  // reported no flaky test.
  retries: 0,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    // The interface starts in the browser's language (src/i18n/index.ts), and
    // a browser's default follows the machine's: pinned, so the specs read
    // Italian on every runner. A spec about another language sets its own.
    locale: "it-IT",
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `vite build --base / --outDir dist-e2e && vite preview --outDir dist-e2e --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
  },
});
