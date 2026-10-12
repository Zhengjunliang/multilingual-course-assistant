/**
 * A field ties its hint and its refusal to the input, the refusal first, and
 * counts what is left of its length; a search field is named without a
 * visible label and names the key that reaches it.
 */

import { describe, expect, it } from "vitest";

import { render } from "@/test/render";
import { Field, SearchField } from "./field";

/** The attributes of the one input in `html`. */
function input(html: string): Record<string, string> {
  const tag = html.match(/<input[^>]*>/)?.[0] ?? "";
  return Object.fromEntries(
    [...tag.matchAll(/([\w-]+)="([^"]*)"/g)].map(([, name = "", value = ""]) => [name, value]),
  );
}

describe("a field", () => {
  it("is described by its hint, and by its refusal first once refused", () => {
    const quiet = input(render(<Field id="user" label="Nome utente" hint="Esiste già." />));
    const refused = input(
      render(<Field id="user" label="Nome utente" hint="Esiste già." error="Nessun account." />),
    );

    expect({ quiet, refused }).toMatchObject({
      quiet: { "aria-describedby": "user-hint" },
      refused: { "aria-describedby": "user-error user-hint", "aria-invalid": "true" },
    });
    expect(quiet["aria-invalid"]).toBeUndefined();
  });

  it("reads a refusal out as it appears when asked to, and not otherwise", () => {
    const quiet = render(<Field id="user" label="Nome utente" error="Nessun account." />);
    const loud = render(<Field id="user" label="Nome utente" error="Nessun account." announce />);

    expect([quiet.includes('role="alert"'), loud.includes('role="alert"')]).toEqual([false, true]);
  });

  it("counts the characters of its value against its maximum", () => {
    const html = render(
      <Field
        id="note"
        label="Messaggio"
        counter
        maxLength={300}
        value="ciao"
        onChange={() => {}}
      />,
    );

    expect(html.replace(/<!-- -->/g, "")).toContain(">4 / 300<");
  });
});

describe("a search field", () => {
  it("is named by its label and names its key", () => {
    const attributes = input(
      render(<SearchField label="Cerca" shortcut={{ keys: "Control+K", label: "Ctrl K" }} />),
    );

    expect(attributes).toMatchObject({
      type: "search",
      "aria-label": "Cerca",
      "aria-keyshortcuts": "Control+K",
    });
  });
});
