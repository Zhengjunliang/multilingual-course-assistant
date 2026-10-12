/** A conversation row's time, and what the sidebar's search finds. */

import { describe, expect, it } from "vitest";

import { timeLabel, titleMatches } from "./rows";

// Local times, as the reader's clock reads them.
const NOW = new Date(2026, 9, 12, 18, 30);
const at = (year: number, month: number, day: number, hour: number, minute: number) =>
  new Date(year, month, day, hour, minute).toISOString();

describe("a conversation's time", () => {
  it("is the hour on the day of the last message", () => {
    expect(timeLabel(at(2026, 9, 12, 9, 5), "it", NOW)).toBe("09:05");
  });

  it("is the word for yesterday, capitalised, in the interface's language", () => {
    expect(timeLabel(at(2026, 9, 11, 23, 59), "it", NOW)).toBe("Ieri");
    expect(timeLabel(at(2026, 9, 11, 0, 1), "en", NOW)).toBe("Yesterday");
  });

  it("is the day and the month before that, with the year once it is another", () => {
    expect(timeLabel(at(2026, 9, 3, 12, 0), "it", NOW)).toBe("3 ott");
    expect(timeLabel(at(2025, 11, 30, 12, 0), "it", NOW)).toBe("30 dic 2025");
  });
});

describe("the sidebar's search", () => {
  it("finds a title whatever its case and accents", () => {
    expect(titleMatches("Perché l'esame è spostato?", "PERCHE", "it")).toBe(true);
    expect(titleMatches("Orari della biblioteca", "  biblio ", "it")).toBe(true);
  });

  it("finds nothing that the title does not contain, and everything when empty", () => {
    expect(titleMatches("Orari della biblioteca", "mensa", "it")).toBe(false);
    expect(titleMatches("Orari della biblioteca", "   ", "it")).toBe(true);
  });
});
