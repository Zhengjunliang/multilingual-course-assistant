import { type ClassValue, clsx } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

/**
 * tailwind-merge told this palette's names (index.css, `@theme`). Without
 * them it takes `text-display` for a colour, so `text-display text-ink` kept
 * only the ink and the heading lost its size; a size and a colour are two
 * groups, and only two of one group conflict.
 */
const twMerge = extendTailwindMerge({
  extend: {
    theme: {
      text: ["caption", "body", "title", "display"],
      color: [
        "canvas",
        "surface",
        "sidebar",
        "ink",
        "muted",
        "line",
        "accent",
        "accent-ink",
        "mark",
        "warn",
        "warn-line",
        "warn-ink",
      ],
    },
  },
});

/** Conditional classes, with later Tailwind utilities winning over earlier ones. */
export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/**
 * How to scroll something into view: smoothly, unless the reader has asked the
 * system for less motion. Read at each call, since the setting can change while
 * the page is open; `motion-reduce:` covers CSS animation, and a scroll started
 * from script has to ask for itself.
 */
export function scrollBehavior(): ScrollBehavior {
  return window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth";
}
