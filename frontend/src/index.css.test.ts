/**
 * What index.css promises that no mounted test can see. jsdom applies no
 * stylesheet, and vitest hands a stylesheet import back empty, so these read
 * the file itself.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const CSS = readFileSync(fileURLToPath(new URL("./index.css", import.meta.url)), "utf8");

describe("the stylesheet", () => {
  it("hides Edge's own eye in a password input, which has a button of its own", () => {
    expect(CSS).toMatch(/input::-ms-reveal\s*\{\s*display:\s*none;\s*\}/);
  });
});
