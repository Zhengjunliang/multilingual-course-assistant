/**
 * The rule against `title` attributes (biome-plugins/no-title-attribute.grit)
 * is switched on, finds every spelling of the attribute and nothing else
 * named `title`, and yields to a suppression.
 *
 * Biome's own engine matches a GritQL pattern. A Biome release that changed
 * how it matches could switch the rule off without a word, every file simply
 * passing, or widen it until it refused ordinary code at commit time. So a
 * fixture goes through the same Biome and the same pattern file, and exactly
 * its three unsuppressed attributes must be reported: not the variable, the
 * assignment or the default named `title` beside them. It is linted in a
 * directory of its own, with every other rule off, because inside `frontend/`
 * it would have to be a file the linted paths leave out, and Biome skips such
 * a file even when it is named; and lint on stdin reports no diagnostics,
 * only that there are some.
 */

import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const PLUGIN = "./biome-plugins/no-title-attribute.grit";
const FRONTEND = fileURLToPath(new URL("../..", import.meta.url));
const BIOME = join(FRONTEND, "node_modules/@biomejs/biome/bin/biome");

const FIXTURE = `export function Fixture(note: (title?: string) => void) {
  let title = "a variable";
  title = "an assignment";
  function headed(title = "a default") {
    return title;
  }
  note(title);
  headed();
  return (
    <>
      <span title={"an expression"}>a</span>
      <abbr title="a literal">b</abbr>
      <abbr title>c</abbr>
      {/* biome-ignore lint/plugin: an iframe is named by its title */}
      <iframe title="suppressed" src="about:blank" />
      <Dialog heading="a component's own prop" />
    </>
  );
}
`;

describe("the rule against title attributes", () => {
  it("is one of the plugins the linter runs", () => {
    const config = JSON.parse(readFileSync(join(FRONTEND, "biome.json"), "utf8")) as {
      plugins?: string[];
    };

    expect(config.plugins).toContain(PLUGIN);
  });

  it("reports every spelling of the attribute, and no variable, suppression or prop", () => {
    const dir = mkdtempSync(join(tmpdir(), "no-title-"));
    try {
      writeFileSync(
        join(dir, "biome.json"),
        JSON.stringify({
          plugins: [join(FRONTEND, PLUGIN)],
          linter: { enabled: true, rules: { recommended: false } },
          formatter: { enabled: false },
        }),
      );
      writeFileSync(join(dir, "fixture.tsx"), FIXTURE);
      const run = spawnSync(process.execPath, [BIOME, "lint", "fixture.tsx"], {
        cwd: dir,
        encoding: "utf8",
      });
      const output = `${run.stdout}${run.stderr}`;
      const lines = [...output.matchAll(/fixture\.tsx:(\d+):\d+ plugin/g)].map((match) =>
        Number(match[1]),
      );

      expect(lines).toEqual([11, 12, 13]);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
