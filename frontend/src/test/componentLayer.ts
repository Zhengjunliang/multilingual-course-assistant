/**
 * Reading the component layer off the disk, for the checks that must not be
 * allowed to go stale.
 *
 * Both callers could have kept their own list of components. That list is the
 * thing that rots: a primitive gets added, the list does not, and the check
 * that was supposed to notice reports success. Reading the directory is what
 * makes "every component" mean every component.
 *
 * `fileURLToPath` and not `new URL(...).pathname` for the reason vite.config.ts
 * already records: on Windows the latter yields "/D:/…", which no filesystem
 * call accepts.
 *
 * This only works under the `node` environment, which is the default and which
 * every caller of this module uses. Ask for jsdom in one of them and
 * `import.meta.url` becomes an http URL served by Vite's client transform, at
 * which point `fileURLToPath` refuses it outright. vite.config.ts records why
 * the document is opt-in per file rather than global; this is one of the
 * reasons.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const DIR = fileURLToPath(new URL("../components/ui", import.meta.url));

/** Source files of the component layer, tests excluded. */
export function componentFiles(): string[] {
  return readdirSync(DIR).filter((name) => /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name));
}

export function sourceOf(name: string): string {
  return readFileSync(join(DIR, name), "utf8");
}

function names(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)]
    .map((match) => match[1])
    .filter((name): name is string => name !== undefined);
}

/** Components and hooks — the exports that can appear on a page. */
export function valueExportsOf(source: string): string[] {
  return names(
    source,
    /^export\s+(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/gm,
  );
}

/** Types and interfaces, which render nothing but can still collide by name. */
export function typeExportsOf(source: string): string[] {
  return names(source, /^export\s+(?:type|interface)\s+([A-Za-z_$][\w$]*)/gm);
}
