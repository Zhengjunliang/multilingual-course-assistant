/**
 * The table's markup: a selected row says so to the stylesheet and nothing
 * else, since a row of a plain table takes no selection state.
 */

import { describe, expect, it } from "vitest";

import { Table, TableBody, TableCell, TableRow } from "@/components/ui/table";
import { render } from "@/test/render";

function rows(selected: boolean): string {
  return render(
    <Table aria-label="Edizioni">
      <TableBody>
        <TableRow selected={selected}>
          <TableCell>2025-2026</TableCell>
        </TableRow>
      </TableBody>
    </Table>,
  );
}

describe("a table row", () => {
  it("carries data-selected while selected, and no aria-selected either way", () => {
    expect([
      rows(true).includes('data-selected="true"'),
      rows(false).includes('data-selected="'),
    ]).toEqual([true, false]);
    expect(rows(true).includes('aria-selected="')).toBe(false);
  });
});
