/**
 * An address the application does not have says so, through the whole route
 * table: the catch-all used to redirect to the chat without a word, and the
 * assertion that matters is that it no longer does.
 *
 * No session: the page sits outside `RequireSession`, so a string render of
 * `App` reaches it with no provider, and would fail loudly if it ever moved
 * behind the gate.
 */

import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";

import App from "@/App";
import { render } from "@/test/render";

function at(path: string): string {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

describe("an address the application does not have", () => {
  it("is told it was not found, with the way back to the start", () => {
    const html = at("/no/such/page");

    expect(html).toContain("Pagina non trovata");
    expect(html).toContain('href="/"');
    expect(html).toContain("Torna all&#x27;inizio");
  });
});
