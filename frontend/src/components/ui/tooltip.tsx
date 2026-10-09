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
 * not one passing over a row of badges, and focus opens it at once.
 */

import * as RadixTooltip from "@radix-ui/react-tooltip";
import type { ReactElement, ReactNode } from "react";

interface TooltipProps {
  /** What the hint says. */
  content: ReactNode;
  /** The element the hint is for, rendered as the trigger itself: it must accept a ref and DOM props. */
  children: ReactElement;
}

export function Tooltip({ content, children }: TooltipProps) {
  return (
    <RadixTooltip.Provider>
      <RadixTooltip.Root>
        <RadixTooltip.Trigger asChild>{children}</RadixTooltip.Trigger>
        <RadixTooltip.Portal>
          <RadixTooltip.Content
            sideOffset={4}
            collisionPadding={8}
            className="z-floating max-w-xs rounded-chip bg-ink px-tight py-hair text-caption text-canvas wrap-anywhere shadow-overlay"
          >
            {content}
          </RadixTooltip.Content>
        </RadixTooltip.Portal>
      </RadixTooltip.Root>
    </RadixTooltip.Provider>
  );
}
