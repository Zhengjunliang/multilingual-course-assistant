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
  // One more try in CI, where a shared runner can stall a frame: red twice
  // fails the job, green the second time is reported as flaky. None locally,
  // so whoever runs it sees the red at once.
  retries: CI ? 1 : 0,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${PORT}`,
    trace: "retain-on-failure",
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  webServer: {
    command: `vite build --base / --outDir dist-e2e && vite preview --outDir dist-e2e --host 127.0.0.1 --port ${PORT} --strictPort`,
    url: `http://127.0.0.1:${PORT}`,
    reuseExistingServer: false,
  },
});
