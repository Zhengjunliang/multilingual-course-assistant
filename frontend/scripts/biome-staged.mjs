/**
 * Biome over the files a commit stages: the `biome` hook of
 * .pre-commit-config.yaml.
 *
 * pre-commit runs a hook from the repository root and names files from there,
 * `frontend/src/App.tsx`. Biome has to run from `frontend/`, beside its
 * configuration: pointed at it from the root with `--config-path`, it stops
 * at "Found a nested root configuration". So this drops the `frontend/`
 * prefix and runs Biome in `frontend/`, with the arguments `npm run lint`
 * gives it, on the staged files alone. `check`, as there: the formatter and
 * the order of imports are held as well as the lint rules.
 */

import { spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const FRONTEND = fileURLToPath(new URL("..", import.meta.url));
const BIOME = join(FRONTEND, "node_modules/@biomejs/biome/bin/biome");

if (!existsSync(BIOME)) {
  console.error("Biome is not installed: run `npm ci --prefix frontend` first.");
  process.exit(1);
}

const files = process.argv.slice(2).map((path) => path.replace(/^frontend[\\/]/, ""));
const run = spawnSync(
  process.execPath,
  [BIOME, "check", "--no-errors-on-unmatched", "--files-ignore-unknown=true", ...files],
  { cwd: FRONTEND, stdio: "inherit" },
);
process.exit(run.status ?? 1);
