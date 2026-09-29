import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

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
