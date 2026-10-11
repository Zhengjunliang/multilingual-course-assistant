/**
 * The entry has something on it: the caption a reader is greeted with, under
 * the living cat.
 */

import { describe, expect, it } from "vitest";

import { render } from "@/test/render";
import { EntryScreen } from "./EntryScreen";

describe("the entry", () => {
  it("tells the reader to ask in their own language, under the living cat", () => {
    const rendered = render(<EntryScreen visitor={false} />);

    expect(rendered).toContain("Chiedi in qualsiasi lingua.");
    expect(rendered).toContain("data-living-mascot");
  });
});
