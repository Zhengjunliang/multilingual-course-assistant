/// <reference types="vitest/config" />
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const DJANGO = "http://127.0.0.1:8000";

// Everything Django owns. `/admin` and `/static` are here for a reason that
// outlives convenience: between the login stage and the SPA's own login page
// there is no way into a session from this origin, so the developer signs in at
// http://localhost:5173/admin/ and the cookie lands on the SPA's own origin.
// Read that before deleting either entry.
const DJANGO_PATHS = ["/api", "/admin", "/static"];

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],

  resolve: {
    // `fileURLToPath`, not `URL.pathname`: on Windows the latter yields
    // "/D:/…", which is not a path any filesystem call accepts.
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },

  // Built assets are served by Django under STATIC_URL; the dev server serves
  // them from the root. Only the build needs the prefix.
  base: command === "build" ? "/static/" : "/",

  // jsdom, and one dependency rather than the three an earlier note here
  // predicted — that count was true of the testing-library route, not of this
  // one. React 19 exports `act` itself and `react-dom/client` exports
  // `createRoot`, so `src/test/mount.tsx` needs no library beyond a document.
  //
  // What the document buys is the half of the interface a string render cannot
  // reach: Radix aims its portals at `document.body`, so the account dialog
  // renders as an empty string without one, and `renderToStaticMarkup` runs no
  // effects and dispatches no events, so nothing that happens on a click was
  // testable at all. Those are the newest and least-proven parts of this
  // interface, which is a poor thing to leave to a manual list.
  //
  // `src/test/render.tsx` stays and is not a leftover: markup assertions want a
  // tree rendered once with no effects, behaviour assertions want a live
  // document, and asking one helper to be both would make every test pay for
  // the heavier one. The file headers say which is which.
  //
  // The document is asked for per file, with a `@vitest-environment jsdom`
  // docblock, and the default stays `node`. Switching it globally was tried and
  // reverted, for a reason worth keeping: under jsdom, Vite resolves modules
  // with its client conditions and `import.meta.url` becomes the http URL the
  // dev server would serve, so `fileURLToPath(new URL(…, import.meta.url))`
  // fails with "The URL must be of scheme file". Four tests here read their
  // subject off the disk that way — the component catalogue, the token aliases,
  // the chat page's source — and none of them wants a document at all. Making
  // every test pay for a synthetic realm so that two of them can have one also
  // cost five times the wall clock, almost all of it spent building environments.
  //
  // Leave `pool` alone. On the default forks pool a jsdom file still sees
  // Node's `ReadableStream`, `TextDecoder` and `TextEncoder`, which is what
  // `api/sse.test.ts` is built on; `pool: "vmThreads"` copies `ReadableStream`
  // neither into the VM context nor back out, and all ten of those cases die
  // with a ReferenceError.
  test: {
    // Runs in both environments, and checks before it touches a window: jsdom
    // is not a browser and lacks three APIs this repository already calls.
    setupFiles: ["src/test/setup.ts"],
    // `globals` stays off, so every test imports describe/it/expect from
    // "vitest" by name. That keeps tsconfig's `types` array as it is and leaves
    // biome with no undeclared identifiers to shrug at.
    include: ["src/**/*.test.{ts,tsx}"],
  },

  server: {
    proxy: Object.fromEntries(
      DJANGO_PATHS.map((path) => [
        path,
        {
          target: DJANGO,
          // Deliberately false: forwarding keeps `Host: localhost:5173`, so the
          // `Origin` Django checks equals the host it thinks it is serving and
          // CSRF passes without a CSRF_TRUSTED_ORIGINS entry. Flipping this to
          // true breaks every unsafe request in development.
          changeOrigin: false,
        },
      ]),
    ),
  },
}));
