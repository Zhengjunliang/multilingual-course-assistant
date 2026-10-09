/**
 * The three catalogues must carry exactly the same keys, and Chinese strings
 * take Chinese punctuation.
 *
 * A missing key does not crash — i18next falls back and the reader sees Italian
 * inside an English page — so nothing else would catch it. Translation quality
 * still needs eyes; this only guarantees that every string has a slot in every
 * language, and that a Chinese string writes the full-width comma, colon,
 * semicolon, question and exclamation marks rather than the Latin ones, which
 * Figtree draws narrow: the Chinese stack hands it U+0000-00FF. An
 * interpolation, a nested key and a time such as 8:30 keep their Latin marks.
 */

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

// `fileURLToPath`, not `URL.pathname`: on Windows the latter yields "/D:/…",
// which `join` then turns into "D:\D:\…".
const CATALOGUE_DIR = fileURLToPath(new URL("../src/i18n", import.meta.url));

const CHINESE_CATALOGUE = "zh-hans.json";
const HAN = /\p{Script=Han}/u;
const LATIN_MARK = /[,:;?!]/;
/** i18next's `{{value, format}}` and `$t(key, options)`, and a time. */
const NOT_PROSE = /\{\{[^}]*\}\}|\$t\([^)]*\)|\d:\d/g;

/** Each leaf of a catalogue as [key, value]. */
function entries(value, prefix = "") {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return [[prefix, value]];
  return Object.entries(value).flatMap(([key, child]) =>
    entries(child, prefix ? `${prefix}.${key}` : key),
  );
}

const files = readdirSync(CATALOGUE_DIR).filter((name) => name.endsWith(".json"));
if (files.length === 0) {
  console.error("no catalogues found in src/i18n");
  process.exit(1);
}

const entriesByFile = new Map(
  files.map((name) => [name, entries(JSON.parse(readFileSync(join(CATALOGUE_DIR, name), "utf8")))]),
);
const keysByFile = new Map(
  [...entriesByFile].map(([name, leaves]) => [name, new Set(leaves.map(([key]) => key))]),
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

if (!entriesByFile.has(CHINESE_CATALOGUE)) {
  failed = true;
  console.error(`no ${CHINESE_CATALOGUE} in src/i18n: its punctuation went unchecked`);
}
const latinMarks = (entriesByFile.get(CHINESE_CATALOGUE) ?? []).filter(
  ([, value]) =>
    typeof value === "string" && HAN.test(value) && LATIN_MARK.test(value.replace(NOT_PROSE, "")),
);
if (latinMarks.length > 0) {
  failed = true;
  console.error(
    `${CHINESE_CATALOGUE} writes Latin punctuation in ${latinMarks.length} Chinese string(s):`,
  );
  for (const [key, value] of latinMarks) console.error(`  ${key}: ${value}`);
}

if (failed) process.exit(1);
console.log(
  `${files.length} catalogues, ${everyKey.size} keys, all present; no Latin , : ; ? ! in a Chinese string.`,
);
