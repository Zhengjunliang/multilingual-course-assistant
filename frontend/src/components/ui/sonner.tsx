/**
 * Where a finished action says it is done: a toast in the corner, gone after a
 * few seconds, the shadcn/ui wrapper of Sonner (outside the repository: ui.shadcn.com,
 * "Sonner").
 *
 * A toast and not a line on the page: the page has moved on — a dialog
 * closed, a row changed — and the confirmation belongs to no part of it.
 * Sonner reads each toast out in a polite live region of its own, so it is
 * heard without taking focus. Its surface is this palette's, through the
 * variables Sonner styles itself with, and its theme follows the one painted;
 * outside a `ThemeProvider`, as on /styleguide, which paints both themes
 * itself, it follows the system.
 */

import { type CSSProperties, useContext } from "react";
import { Toaster as Sonner } from "sonner";

import { ThemeContext } from "@/theme/ThemeProvider";

export function Toaster() {
  const theme = useContext(ThemeContext);
  return (
    <Sonner
      theme={theme?.resolved ?? "system"}
      position="bottom-right"
      style={
        {
          "--normal-bg": "var(--surface)",
          "--normal-text": "var(--ink)",
          "--normal-border": "var(--line)",
        } as CSSProperties
      }
    />
  );
}
