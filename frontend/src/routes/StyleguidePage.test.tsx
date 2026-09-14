/**
 * The catalogue is complete, and stays complete.
 *
 * The list of components comes from the directory, not from this file: a
 * primitive added to `components/ui/` and left out of the page fails here,
 * which is the only version of "every component is in the catalogue" that
 * survives someone being in a hurry.
 */

import { describe, expect, it } from "vitest";

import { componentFiles, sourceOf, valueExportsOf } from "@/test/componentLayer";
import { render } from "@/test/render";
import StyleguidePage from "./StyleguidePage";

function everyComponentName(): string[] {
  return componentFiles().flatMap((file) => valueExportsOf(sourceOf(file)));
}

describe("the component catalogue", () => {
  it("knows which components exist", () => {
    // Without this, an empty directory listing would make the next test pass
    // by having nothing to look for.
    expect(everyComponentName().length).toBeGreaterThan(0);
  });

  it("names every component of the layer", () => {
    const html = render(<StyleguidePage />);
    const missing = everyComponentName().filter((name) => !html.includes(name));

    expect(missing).toEqual([]);
  });

  it("shows both themes at once", () => {
    // A toggle would show one theme at a time, which is how a component ends up
    // right in one and wrong in the other. Both panels are on the page together.
    const html = render(<StyleguidePage />);

    expect(html).toContain('data-theme="light"');
    expect(html).toContain('data-theme="dark"');
  });
});
