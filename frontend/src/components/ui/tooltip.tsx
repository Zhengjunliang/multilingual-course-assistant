/**
 * A hint beside a control or a mark: it opens for a pointer resting on it and
 * for keyboard focus, and Escape closes it.
 *
 * The one way this interface shows a hint. The browser's `title` attribute is
 * not one, and the linter refuses it (biome-plugins/no-title-attribute.grit):
 * it opens for a resting mouse alone, never for focus or a touch, and screen
 * readers announce it inconsistently. A hint can still be missed, since
 * a touch screen has no pointer to rest, so it only ever repeats what the
 * visible text or the accessible name already says (DESIGN.md, "Components").
 *
 * Ported from shadcn/ui (MIT, github.com/shadcn-ui/ui) in this repository's
 * manner (dropdown-menu.tsx says why): one component wrapping the Radix parts
 * it needs, on the tokens. The surface is the inverse of the page, ink with
 * canvas lettering, which stays the inverse in both themes. Each tooltip
 * carries its own provider, as upstream now does, so a tooltip renders
 * wherever it is used, in a test or on /styleguide, with nothing above it.
 * The delays are Radix's own: a hint opens for a pointer that stops on it,
 * not one passing over a row of buttons, and focus opens it at once. An
 * arrow points at what the hint is for, and `shortcut` puts the key that
 * does the same at its right, outlined in the hint's own lettering, and on
 * the trigger as `aria-keyshortcuts` (#190).
 */

import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

import { Kbd, type Shortcut } from "@/components/ui/kbd";

interface TooltipProps {
  /** What the hint says. */
  content: ReactNode;
  /** The element the hint is for, rendered as the trigger itself: it must accept a ref and DOM props. */
  children: ReactElement;
  shortcut?: Shortcut;
}

export function Tooltip({ content, children, shortcut }: TooltipProps) {
  return (
    <RadixTooltip.Provider>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild aria-keyshortcuts={shortcut?.keys}>
          {children}
        </RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            sideOffset={4}
            collisionPadding={8}
            className="z-floating flex max-w-xs items-center gap-tight rounded-chip bg-ink px-tight py-hair font-medium text-caption text-canvas wrap-anywhere shadow-overlay"
          >
            {content}
            {shortcut !== undefined && <Kbd tone="inherit">{shortcut.label}</Kbd>}
            <RadixTooltip.Arrow width={10} height={5} className="fill-ink" />
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
