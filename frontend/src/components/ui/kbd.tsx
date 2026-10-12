/**
 * A key, drawn as a keycap: a 2 px bottom edge, like the key it stands for
 * (#190, rule 5: menu items and primary buttons show their key, the search
 * field its Ctrl K).
 *
 * Hidden from assistive technology. A key read out inside a button's or a
 * menu item's name would turn "Cerca" into "Cerca Ctrl K"; the control it
 * labels says it instead, in `aria-keyshortcuts`, which is the attribute
 * screen readers announce as the shortcut. `Shortcut` carries both halves:
 * the keys in that attribute's syntax ("Control+K") and the label shown on
 * the cap ("Ctrl K"), which a catalogue may translate ("Invio" for Enter).
 *
 * `inherit` draws the cap in the colour of the text it sits in, for a
 * filled button or a tooltip, where a surface-coloured cap would be a hole.
 */

import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface Shortcut {
  /** In `aria-keyshortcuts` syntax, such as "Control+Shift+O". */
  keys: string;
  /** What the cap shows, such as "Ctrl ⇧ O". */
  label: string;
}

interface KbdProps {
  children: ReactNode;
  tone?: "default" | "inherit";
  className?: string;
}

export function Kbd({ children, tone = "default", className }: KbdProps) {
  return (
    <kbd
      aria-hidden
      className={cn(
        "inline-flex h-icon-lg min-w-icon-lg shrink-0 items-center justify-center whitespace-nowrap rounded-chip border border-b-2 px-hair font-mono text-caption leading-none",
        tone === "default" ? "border-line bg-surface text-muted" : "border-current/40",
        className,
      )}
    >
      {children}
    </kbd>
  );
}
