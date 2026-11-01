/**
 * What Tailwind CSS IntelliSense flags in the editor, the chain flags: this runs
 * the extension's own language server, `@tailwindcss/language-server`, the
 * version the extension bundles, over every tracked file of a language it reads,
 * and fails on any diagnostic it publishes: a class Tailwind writes another way
 * (`min-w-[45rem]` for `min-w-reading`), two classes that set the same
 * properties, an `@apply` of an unknown class, and its other lints, at their
 * default settings, as the repository sets none.
 *
 * The editor checks only the files it has open, so a warning in a file nobody
 * opened reaches nobody. Tailwind has no command that lints files: its CLI's
 * `canonicalize` rewrites one class list it is given, and is one lint of ten.
 * The server speaks LSP over stdio, so this is the least of a client: it starts
 * the server on the repository, as VS Code opens it, opens each file, and waits
 * for that file's diagnostics, which the server publishes for every file it is
 * given, an empty list for one outside the Tailwind project. Loading the project
 * takes most of its 4 to 5 s, which is why it runs in the chain and not at
 * commit time.
 */

import { execFileSync, spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { extname, join } from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";

const ROOT = fileURLToPath(new URL("../..", import.meta.url));
const ROOT_URI = pathToFileURL(ROOT).href;
const PACKAGE = "@tailwindcss/language-server";
const require = createRequire(import.meta.url);
const SERVER = join(
  require.resolve(`${PACKAGE}/package.json`),
  "../bin/tailwindcss-language-server",
);
const { version } = require(`${PACKAGE}/package.json`);
/** The languages the server reads that the repository holds, by extension. */
const LANGUAGES = {
  ".css": "css",
  ".html": "html",
  ".js": "javascript",
  ".md": "markdown",
  ".mjs": "javascript",
  ".ts": "typescript",
  ".tsx": "typescriptreact",
};
/** A server that has not answered for every file by then is stuck, not slow. */
const TIMEOUT_MS = 120_000;

const files = execFileSync(
  "git",
  ["ls-files", "--", ...Object.keys(LANGUAGES).map((extension) => `*${extension}`)],
  { cwd: ROOT, encoding: "utf8" },
)
  .split("\n")
  .filter(Boolean);

const server = spawn(process.execPath, [SERVER, "--stdio"], {
  stdio: ["pipe", "pipe", "inherit"],
});
server.on("exit", (code) => {
  console.error(`The Tailwind CSS language server stopped (exit code ${code}).`);
  process.exit(1);
});

function send(message) {
  const body = Buffer.from(JSON.stringify({ jsonrpc: "2.0", ...message }), "utf8");
  server.stdin.write(`Content-Length: ${body.length}\r\n\r\n`);
  server.stdin.write(body);
}

/** Each opened file's URI, to what its first diagnostics resolve. */
const awaited = new Map();
/** Each file's path, to the diagnostics the server last published for it. */
const findings = new Map();
let initialized = () => {};

function receive(message) {
  if (message.id !== undefined && message.method === undefined) {
    initialized();
  } else if (message.id !== undefined) {
    // The server asks for its settings and registers capabilities: an empty
    // section leaves every setting at its default.
    const { method, params } = message;
    send({
      id: message.id,
      result: method === "workspace/configuration" ? params.items.map(() => ({})) : null,
    });
  } else if (message.method === "textDocument/publishDiagnostics") {
    const { uri, diagnostics } = message.params;
    const path = decodeURIComponent(uri.slice(ROOT_URI.length));
    findings.set(
      path,
      diagnostics.map(
        ({ range, message: text, code }) =>
          `${path}:${range.start.line + 1}:${range.start.character + 1}  ${text}  (${code})`,
      ),
    );
    awaited.get(uri)?.();
  }
}

let buffer = Buffer.alloc(0);
server.stdout.on("data", (chunk) => {
  buffer = Buffer.concat([buffer, chunk]);
  for (;;) {
    const end = buffer.indexOf("\r\n\r\n");
    if (end < 0) return;
    const length = Number(/Content-Length: (\d+)/i.exec(buffer.subarray(0, end).toString())[1]);
    if (buffer.length < end + 4 + length) return;
    receive(JSON.parse(buffer.subarray(end + 4, end + 4 + length).toString("utf8")));
    buffer = buffer.subarray(end + 4 + length);
  }
});

const timer = setTimeout(() => {
  console.error(
    `The Tailwind CSS language server answered for ${files.length - awaited.size} of ${files.length} files in ${TIMEOUT_MS / 1000} s.`,
  );
  process.exit(1);
}, TIMEOUT_MS);

await new Promise((resolve) => {
  initialized = resolve;
  send({
    id: 1,
    method: "initialize",
    params: {
      processId: process.pid,
      rootUri: ROOT_URI,
      workspaceFolders: [{ uri: ROOT_URI, name: "multilingual-course-assistant" }],
      capabilities: { workspace: { configuration: true, workspaceFolders: true } },
    },
  });
});
send({ method: "initialized", params: {} });

await Promise.all(
  files.map((file) => {
    const uri = pathToFileURL(join(ROOT, file)).href;
    const answered = new Promise((resolve) =>
      awaited.set(uri, () => {
        awaited.delete(uri);
        resolve();
      }),
    );
    const text = readFileSync(join(ROOT, file), "utf8");
    const languageId = LANGUAGES[extname(file)];
    send({
      method: "textDocument/didOpen",
      params: { textDocument: { uri, languageId, version: 1, text } },
    });
    return answered;
  }),
);
clearTimeout(timer);
server.removeAllListeners("exit");
server.kill();

const flagged = [...findings.values()].flat();
if (flagged.length > 0) {
  console.error(`Tailwind CSS IntelliSense ${version} flags ${flagged.length} problem(s):`);
  for (const finding of flagged) console.error(`  ${finding}`);
  process.exit(1);
}
console.log(
  `${files.length} files, as Tailwind CSS IntelliSense ${version} reads them: nothing flagged.`,
);
process.exit(0);
