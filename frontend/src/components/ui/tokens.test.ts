/**
 * The component layer has exactly one of each component.
 *
 * These read the directory rather than a list written by hand, which is the
 * whole point: a primitive added and forgotten has to be caught by the check,
 * not by the person who would have had to remember to update it.
 *
 * `fileURLToPath` and not `new URL(...).pathname` for the reason vite.config.ts
 * already records: on Windows the latter yields "/D:/…", which no filesystem
 * call accepts.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = fileURLToPath(new URL(".", import.meta.url));

/** Source files of the component layer, tests excluded. */
function componentFiles(): string[] {
  return readdirSync(HERE).filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name));
}

function sourceOf(name: string): string {
  return readFileSync(join(HERE, name), "utf8");
}

/**
 * Names a file exports, values and types alike. A type sharing a name with a
 * component in another file is the same collision seen from the other side.
 */
function exportsOf(source: string): string[] {
  const value = /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm;
  const type = /^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm;
  return [...source.matchAll(value), ...source.matchAll(type)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
}

describe("the component layer", () => {
  it("has files to check", () => {
    // Guards the checks below: a glob that quietly matched nothing would let
    // every other assertion in this file pass for the wrong reason.
    expect(componentFiles().length).toBeGreaterThan(0);
  });

  it("exports each name from one file only", () => {
    const owner = new Map<string, string>();
    const collisions: string[] = [];

    for (const file of componentFiles()) {
      for (const name of exportsOf(sourceOf(file))) {
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
