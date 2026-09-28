/**
 * One claim about the chat screen that only its source can answer.
 *
 * The composer is a claim about the *text*: a rendered page shows one branch at
 * a time, so no mount can tell "the composer moves between the branches" from
 * "there are two of them and one is off screen". Rendering would also stand up
 * a router and a session, which the page wants and this claim does not.
 *
 * The breakpoint of the fixed sidebar was asserted here too, as a regex over
 * ChatShell.tsx. It is in `features/chat/ChatShell.test.tsx`: jsdom computes no
 * media query, so no mount says whether the column is on screen at a given
 * width, but the classes that decide it are in the DOM, and the mounted
 * `aside`'s class list answers the same question without breaking when the
 * class string is built with `cn(...)` or reordered.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PAGE = readFileSync(fileURLToPath(new URL("ChatPage.tsx", import.meta.url)), "utf8");

describe("the chat screen", () => {
  it("keeps one composer, moved rather than duplicated", () => {
    // Two composers would be two places for Enter, the character cap and the
    // stop button to drift apart.
    const composers = [...PAGE.matchAll(/<Composer\b/g)];

    expect(composers).toHaveLength(1);
  });
});
