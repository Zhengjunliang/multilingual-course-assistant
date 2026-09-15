/**
 * One invariant about the page, and it is a source-level one.
 *
/**
 * Two claims about the chat screen that only its source can answer.
 *
 * The drawer used to be asserted here by spelling out class names, because
 * ChatPage wants a router and a session and `Sheet` is a portal a string render
 * cannot see. That moved to `features/chat/ChatShell.test.tsx` along with the
 * frame, and there it is answered by opening the drawer instead.
 *
 * These two stayed because no rendering answers them.
 *
 * The breakpoint is a media query: jsdom loads no stylesheet and computes no
 * layout, so a mounted `aside` looks identical whether or not it would be
 * hidden on a phone. And it cannot be checked from `ChatShell.test.tsx` either,
 * because a file that asks for a document loses `import.meta.url` to Vite's
 * client transform and can no longer read itself off the disk. This file is on
 * the node environment, which is what makes it the place for both.
 *
 * The composer is a claim about the *text*: a rendered page shows one branch at
 * a time, so no mount can tell "the composer moves between the branches" from
 * "there are two of them and one is off screen".
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = new URL(".", import.meta.url);
const PAGE = readFileSync(fileURLToPath(new URL("ChatPage.tsx", HERE)), "utf8");
const SHELL = readFileSync(fileURLToPath(new URL("../features/chat/ChatShell.tsx", HERE)), "utf8");

describe("the chat screen", () => {
  it("hides the fixed sidebar below the large breakpoint", () => {
    expect(SHELL).toMatch(/<aside[^>]*className="[^"]*\bhidden\b[^"]*\blg:block\b/);
  });

  it("keeps one composer, moved rather than duplicated", () => {
    // Two composers would be two places for Enter, the character cap and the
    // stop button to drift apart.
    const composers = [...PAGE.matchAll(/<Composer\b/g)];

    expect(composers).toHaveLength(1);
  });
});
