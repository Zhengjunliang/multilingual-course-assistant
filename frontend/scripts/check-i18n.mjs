/**
 * The three catalogues must carry exactly the same keys.
 *
 * A missing key does not crash — i18next falls back and the reader sees Italian
 * inside an English page — so nothing else would catch it. Translation quality
 * still needs eyes; this only guarantees that every string has a slot in every
 * language.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// `fileURLToPath`, not `URL.pathname`: on Windows the latter yields "/D:/…",
// which `join` then turns into "D:\D:\…".
const CATALOGUE_DIR = fileURLToPath(new URL("../src/i18n", import.meta.url));

function flatten(value, prefix = "") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [prefix];
  return Object.entries(value).flatMap(([key, child]) =>
    flatten(child, prefix ? `${prefix}.${key}` : key),
  );
}

const files = readdirSync(CATALOGUE_DIR).filter((name) => name.endsWith(".json"));
if (files.length === 0) {
  console.error("no catalogues found in src/i18n");
  process.exit(1);
}

const keysByFile = new Map(
  files.map((name) => [
    name,
    new Set(flatten(JSON.parse(readFileSync(join(CATALOGUE_DIR, name), "utf8")))),
  ]),
);

const everyKey = new Set([...keysByFile.values()].flatMap((keys) => [...keys]));

let failed = false;
for (const [name, keys] of keysByFile) {
  const missing = [...everyKey].filter((key) => !keys.has(key)).sort();
  if (missing.length > 0) {
    failed = true;
    console.error(`${name} is missing ${missing.length} key(s):`);
    for (const key of missing) console.error(`  ${key}`);
  }
}

if (failed) process.exit(1);
console.log(`${files.length} catalogues, ${everyKey.size} keys, all present.`);
