/**
 * The component layer has one of each component, and spends distance through
 * named tokens.
 *
 * Both checks read the directory rather than a list written by hand, which is
 * the point: a primitive added and forgotten has to be caught by the check, not
 * by the person who would have had to remember to update it. A listing that
 * matched nothing would let every check here pass; `routes/StyleguidePage.test.tsx`
 * fails on that, through the same helper.
 */

import { describe, expect, it } from "vitest";

import { componentFiles, sourceOf, typeExportsOf, valueExportsOf } from "@/test/componentLayer";

/**
 * Tailwind steps that say how far rather than what for.
 *
 * Width is deliberately absent. `w-72` on a source card and `max-w-[85vw]` on
 * the drawer are one-off measurements of a layout, not steps on an interior
 * rhythm two components could disagree about — naming them would invent a
 * vocabulary with one word in it. Heights are here because a control's height
 * is exactly the kind of thing three components have to agree on.
 *
 * Zero is not a step: `p-0` takes a distance away rather than choosing one,
 * the way `rounded-full` is a shape rather than a corner size, so a bare `0`
 * passes and `0.5` does not.
 *
 * The alternation is ordered longest-first so that `min-h-20` is consumed whole
 * instead of being counted twice, once as itself and once as `h-20`.
 */
const RAW_STEP =
  /\b(?:min-h-|max-h-|h-|gap-[xy]?-?|[pm][xytbrl]?-)(?!0(?![.\d]))\d+\b|\btext-(?:xs|sm|base|lg|xl|[2-9]xl)\b/g;

describe("the component layer", () => {
  it("exports each name from one file only", () => {
    const owner = new Map<string, string>();
    const collisions: string[] = [];

    for (const file of componentFiles()) {
      const source = sourceOf(file);
      for (const name of [...valueExportsOf(source), ...typeExportsOf(source)]) {
        const first = owner.get(name);
        if (first === undefined) {
          owner.set(name, file);
        } else {
          collisions.push(`${name}: ${first} and ${file}`);
        }
      }
    }

    expect(collisions).toEqual([]);
  });

  it("spends spacing and type through named tokens only", () => {
    // There were 24 of these before the token layer existed: a component saying
    // `px-4` states a distance, and two components meaning "a control's side
    // padding" have no way to stay the same distance once one is edited alone.
    const raw: string[] = [];

    for (const file of componentFiles()) {
      for (const [step] of sourceOf(file).matchAll(RAW_STEP)) {
        raw.push(`${file}: ${step}`);
      }
    }

    expect(raw).toEqual([]);
  });

  it("keeps no parallel version of a component", () => {
    // CLAUDE.md rule 6: one correct implementation, and history lives in git.
    // A `-old` or `-v2` beside a component is the shape that rule forbids, and
    // it is also how a restyle quietly becomes two restyles.
    const parallel = componentFiles().filter((name) =>
      /-(new|old|v2|legacy|copy|backup)\.tsx?$/.test(name),
    );

    expect(parallel).toEqual([]);
  });
});
