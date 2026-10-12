/**
 * A card that previews where a link goes, for a pointer resting on the link
 * and for keyboard focus; Escape or moving away closes it.
 *
 * What a source pill in an answer shows (features/chat/AnswerMarkdown.tsx):
 * ChatGPT and Open WebUI preview a citation the same way, on hover, and a
 * click goes to the source itself (read 11 October 2026). A preview, never
 * the only way to reach what it holds: Radix keeps the card out of the tab
 * order, so everything in it is also in the sources panel, and a touch, which
 * has no pointer to rest, follows the link.
 *
 * Ported from shadcn/ui (MIT, github.com/shadcn-ui/ui) in this repository's
 * manner (dropdown-menu.tsx says why): one component wrapping the Radix parts
 * it needs, on the tokens: a card's surface and corners, lifted as an
 * overlay. It opens after 200 ms rather than Radix's 700, so a reader who
 * stops on a pill sees it at once and one passing across a line does not; it
 * waits 150 ms before closing, the time it takes to move from the pill onto
 * the card.
 *
 * Its parts (#190): an optional head on `--tint` behind a hairline, for what
 * the source is (a course or a site, a page, a language); the body; and its
 * actions at the foot, as soft buttons.
 */

import * as RadixHoverCard from "@radix-ui/react-hover-card";
import type { ReactElement, ReactNode } from "react";

interface HoverCardProps {
  /** What the card holds. */
  content: ReactNode;
  /** Above the content, on the tint: what the link points at. */
  head?: ReactNode;
  /** Under the content: soft buttons, such as opening the source. */
  actions?: ReactNode;
  /** The link the card previews, rendered as the trigger itself: it must accept a ref and DOM props. */
  children: ReactElement;
}

export function HoverCard({ content, head, actions, children }: HoverCardProps) {
  return (
    <RadixHoverCard.Root openDelay={200} closeDelay={150}>
      <RadixHoverCard.Trigger asChild>{children}</RadixHoverCard.Trigger>
      <RadixHoverCard.Portal>
        <RadixHoverCard.Content
          sideOffset={6}
          collisionPadding={16}
          className="z-floating flex w-80 max-w-[calc(100vw-2rem)] flex-col overflow-hidden rounded-card border border-line bg-surface text-body text-ink shadow-overlay"
        >
          {head !== undefined && (
            <div className="flex items-center gap-tight border-hairline border-b bg-tint px-snug py-tight font-semibold text-caption">
              {head}
            </div>
          )}
          <div className="flex flex-col gap-snug p-snug">{content}</div>
          {actions !== undefined && (
            <div className="flex items-center gap-tight px-snug pb-snug">{actions}</div>
          )}
        </RadixHoverCard.Content>
      </RadixHoverCard.Portal>
    </RadixHoverCard.Root>
  );
}
