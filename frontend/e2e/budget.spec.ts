/**
 * The bytes a visitor's first screen costs (#134).
 *
 * What counts is what the browser fetches to draw `/`: the page, its
 * stylesheets, its scripts and the fonts it uses, each read from the build and
 * compressed with brotli at quality 11, the way a server would send it. A chunk
 * loaded only when an answer needs it (`MathMarkdown`, which brings KaTeX) is
 * left out by name, so a heavy feature can wait behind `import()` without
 * spending the budget.
 *
 * Two limits. The critical path may not grow by more than a tenth over what it
 * weighed on 9 October 2026: a ratchet against drift, not a target. The scripts
 * may not pass 300 KiB, Alex Russell's figure for a page that loads in three
 * seconds on the 75th-percentile phone and network ("The Performance Inequality
 * Gap 2026", outside the repository). web.dev's 170 KB for the critical path
 * ("Performance budgets 101", outside the repository) is further than either;
 * reaching it means splitting the entry chunk, and is #175.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { brotliCompressSync } from "node:zlib";

import { expect, test } from "./api";

const BUILD = fileURLToPath(new URL("../dist-e2e/", import.meta.url));
const COUNTED = new Set(["document", "stylesheet", "script", "font"]);
const LAZY = /\/assets\/MathMarkdown-/;

/** 9 October 2026: page 390, stylesheet 5 962, script 202 958, fonts 87 394. */
const MEASURED_CRITICAL_PATH = 296_704;
const CRITICAL_PATH_LIMIT = Math.round(MEASURED_CRITICAL_PATH * 1.1);
const SCRIPT_LIMIT = 300 * 1024;

test("a visitor's first screen stays within its byte budget", async ({ page, baseURL }) => {
  const origin = new URL(baseURL ?? "").origin;
  const fetched: { path: string; type: string }[] = [];
  page.on("requestfinished", (request) => {
    const url = new URL(request.url());
    if (url.origin !== origin || url.pathname.startsWith("/api/")) return;
    if (COUNTED.has(request.resourceType())) {
      fetched.push({ path: url.pathname, type: request.resourceType() });
    }
  });
  await page.goto("/");
  await page.waitForLoadState("networkidle");

  const weights = fetched
    .filter(({ path }) => !LAZY.test(path))
    .map(({ path, type }) => {
      const file = path === "/" ? "index.html" : path.slice(1);
      return { path, type, bytes: brotliCompressSync(readFileSync(BUILD + file)).length };
    });
  console.table(weights);

  const total = (rows: typeof weights) => rows.reduce((sum, { bytes }) => sum + bytes, 0);
  expect(weights.map(({ type }) => type)).toEqual(
    expect.arrayContaining(["document", "stylesheet", "script"]),
  );
  expect(total(weights), "critical path, brotli bytes").toBeLessThanOrEqual(CRITICAL_PATH_LIMIT);
  expect(
    total(weights.filter(({ type }) => type === "script")),
    "scripts, brotli bytes",
  ).toBeLessThanOrEqual(SCRIPT_LIMIT);
});
