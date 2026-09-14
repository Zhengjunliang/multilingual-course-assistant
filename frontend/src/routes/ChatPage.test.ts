/**
 * The drawer half of the responsive criterion, checked by reading the source.
 *
 * Not by rendering: ChatPage needs a router and a session, and `Sheet` is a
 * Radix portal aimed at a `document.body` that a string render does not have.
 * A test that mounted three providers to discover that a portal rendered
 * nothing would be a test about the test harness.
 *
 * Reading the source is a weaker check and it is worth saying so plainly: it
 * proves the classes are still written, not that they still work. What it does
 * catch is the realistic failure — someone tidying the layout and dropping the
 * `lg:` prefix, or replacing the drawer with a second sidebar — and that is the
 * failure this stage could have caused.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const SOURCE = readFileSync(fileURLToPath(new URL("./ChatPage.tsx", import.meta.url)), "utf8");

describe("the chat page on a narrow screen", () => {
  it("hides the fixed sidebar below the large breakpoint", () => {
    expect(SOURCE).toMatch(/<aside[^>]*className="[^"]*\bhidden\b[^"]*\blg:block\b/);
  });

  it("still mounts the drawer that replaces it", () => {
    expect(SOURCE).toContain("<Sheet open={drawerOpen}");
  });

  it("keeps one composer, moved rather than duplicated", () => {
    // Two composers would be two places for Enter, the character cap and the
    // stop button to drift apart.
    const composers = [...SOURCE.matchAll(/<Composer\b/g)];

    expect(composers).toHaveLength(1);
  });
});
