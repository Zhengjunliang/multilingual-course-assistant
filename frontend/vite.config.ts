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

  // No jsdom and no happy-dom in devDependencies: the default `node`
  // environment is enough because nothing under test touches a document.
  // markers.ts is string work, and sse.ts needs ReadableStream and TextDecoder,
  // both Node globals long before the 24 in .nvmrc. The React hook in useAsk.ts
  // is deliberately not covered here — rendering it would buy three
  // dependencies and assert React's plumbing rather than this project's logic,
  // and the stream parsing it is often credited with lives in sse.ts anyway.
  test: {
    // `globals` stays off, so every test imports describe/it/expect from
    // "vitest" by name. That keeps tsconfig's `types` array as it is and leaves
    // biome with no undeclared identifiers to shrug at.
    include: ["src/**/*.test.ts"],
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
