/**
 * `cn` keeps a size and a colour of this palette together, and lets a later one
 * of each win, for the theme's spaces, corners and shadows too.
 */

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
    ["two heights", ["min-h-field", "min-h-control-icon"], "min-h-control-icon"],
    ["two paddings", ["px-snug py-tight", "px-hair"], "py-tight px-hair"],
    ["two corners", ["rounded-control", "rounded-full"], "rounded-full"],
    ["two shadows", ["shadow-raised", "shadow-none"], "shadow-none"],
  ])("merges %s", (_, inputs, merged) => {
    expect(cn(...inputs)).toBe(merged);
  });
});
