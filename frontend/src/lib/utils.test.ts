/** `cn` keeps a size and a colour of this palette together, and lets a later one of each win. */

import { describe, expect, it } from "vitest";

import { cn } from "./utils";

describe("cn", () => {
  it.each([
    ["a size and a colour", ["text-display text-ink"], "text-display text-ink"],
    [
      "a colour after a size, in a later argument",
      ["text-body", "text-muted"],
      "text-body text-muted",
    ],
    ["two colours", ["text-ink", "text-muted"], "text-muted"],
    ["two sizes", ["text-caption", "text-body"], "text-body"],
  ])("merges %s", (_, inputs, merged) => {
    expect(cn(...inputs)).toBe(merged);
  });
});
