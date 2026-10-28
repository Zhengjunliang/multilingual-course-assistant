import { join } from "node:path";
import { defineConfig, devices } from "@playwright/test";
import { PASSWORD } from "./journeys/stack";

/**
 * The journeys (#221): the built interface in a real Chromium against the real
 * Django and PostgreSQL, for the flows whose two sides must agree. Only the
 * model and the retrieval are stand-ins: an OpenAI-compatible fake outside the
 * Django process, which the site reaches through `LLM_BASE_URL` alone, and
 * stub encoders over an in-memory index, chosen by `QA_RETRIEVAL`
 * (tests/journeys/).
 *
 * CI only, in the `journeys` job of `.github/workflows/ci.yml`, beside the
 * mocked `browser` job; `npm run e2e:journeys` runs it by hand, with the
 * PostgreSQL container up. Every run builds the SPA, creates the
 * `mca_journeys` database afresh and seeds the demo into it.
 *
 * Ports nothing else uses: 8000 is the developer's `runserver`.
 */
const SITE = 8017;
const MODEL = 8018;
const CI = process.env.CI !== undefined;

// The project's interpreter, from the repository root, without uv: a path
// whose separators the platform's shell reads.
const PYTHON =
  process.platform === "win32"
    ? join(".venv", "Scripts", "python.exe")
    : join(".venv", "bin", "python");

export default defineConfig({
  testDir: "journeys",
  fullyParallel: true,
  // Pinned to what CI's four cores get by default. One Django process serves
  // every worker, its static files included, and answers one question at a
  // time: ten workers on a developer's machine measured that queue (a first
  // answer after thirty seconds), not the code.
  workers: 2,
  forbidOnly: CI,
  // None, as in the mocked suite (docs/testing.md, section "Flaky tests").
  retries: 0,
  reporter: CI ? [["github"], ["list"]] : "list",
  use: {
    baseURL: `http://127.0.0.1:${SITE}`,
    locale: "it-IT",
    trace: "retain-on-failure",
  },
  projects: [
    // Signs in the two demo accounts the other tests start from, once per run
    // (playwright.dev/docs/auth, outside the repository).
    { name: "setup", testMatch: /\.setup\.ts$/ },
    {
      name: "chromium",
      testMatch: /\.spec\.ts$/,
      use: { ...devices["Desktop Chrome"] },
      dependencies: ["setup"],
    },
  ],
  webServer: [
    {
      command: `${PYTHON} -m tests.journeys.fake_llm ${MODEL}`,
      cwd: "..",
      url: `http://127.0.0.1:${MODEL}/health`,
      reuseExistingServer: false,
    },
    {
      // Built to dist/ with the real `/static/` base, which Django serves.
      command: `vite build && cd .. && ${PYTHON} -m tests.journeys.serve ${SITE}`,
      url: `http://127.0.0.1:${SITE}/`,
      reuseExistingServer: false,
      timeout: 120_000,
      env: {
        LLM_BASE_URL: `http://127.0.0.1:${MODEL}/v1`,
        DEMO_PASSWORD: PASSWORD,
        // Whatever the developer's .env says: the configuration CI checks.
        DJANGO_DEBUG: "false",
        DJANGO_BEHIND_TLS: "false",
      },
    },
  ],
});
