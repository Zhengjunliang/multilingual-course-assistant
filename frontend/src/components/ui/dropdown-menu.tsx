/**
 * The menu behind the avatar.
 *
 * Ported from shadcn/ui (MIT, github.com/shadcn-ui/ui) and rewritten on this
 * repository's tokens: upstream paints with `bg-popover`, `border-border` and
 * `text-popover-foreground`, none of which exist here. What is *not* ported is
 * the shape. Upstream exports a dozen names — Root, Trigger, Content, Item,
 * Label, Separator, Group, Sub, RadioItem and the rest — and this interface
 * composes two of them. The other ten would be code nothing runs, which is the
 * definition rule 6 gives for noise, and `StyleguidePage.test.tsx` would demand
 * a specimen for each. `sheet.tsx` already set the precedent: wrap the Radix
 * parts a single component needs and export that component.
 *
 * What comes from Radix is the part worth taking: roving focus with the arrow
 * keys, `Escape`, dismissal on an outside press, `aria-haspopup` wired to the
 * trigger, and focus returned to it on close. Those are the parts a hand-rolled
 * menu gets wrong.
 */

import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

export interface DropdownEntry {
  /** Stable across renders and across languages, so not the label. */
  key: string;
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}

interface DropdownMenuProps {
  /** Rendered as the trigger itself, so it must accept a ref and DOM props. */
  trigger: ReactNode;
  /** A heading above the entries — here, who is signed in. */
  label: string;
  /** A second line under the heading, quieter. */
  caption?: string;
  entries: readonly DropdownEntry[];
  /** Screen-reader name for the trigger. */
  ariaLabel: string;
  /**
   * After the menu has closed and given focus back to the trigger.
   *
   * Exposed because opening a dialog from an entry's `onSelect` puts two
   * components in a race for the focus at once; waiting until the menu has
   * finished is the only ordering that does not depend on timing.
   */
  onCloseAutoFocus?: () => void;
}

export function DropdownMenu({
  trigger,
  label,
  caption,
  entries,
  ariaLabel,
  onCloseAutoFocus,
}: DropdownMenuProps) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger
        aria-label={ariaLabel}
        className="rounded-full focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      >
        {trigger}
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="end"
          sideOffset={8}
          onCloseAutoFocus={() => onCloseAutoFocus?.()}
          className="z-50 flex min-w-48 flex-col rounded-lg border border-line bg-surface p-hair shadow-lg"
        >
          <RadixMenu.Label className="flex flex-col px-tight py-tight">
            <span className="truncate font-medium text-body text-ink">{label}</span>
            {caption !== undefined && (
              <span className="truncate text-caption text-muted">{caption}</span>
            )}
          </RadixMenu.Label>
          <RadixMenu.Separator className="-mx-hair my-hair h-px bg-line" />
          {entries.map((entry) => (
            <RadixMenu.Item
              key={entry.key}
              onSelect={entry.onSelect}
              className="flex cursor-default items-center gap-tight rounded-md px-tight py-tight text-body text-ink outline-none data-highlighted:bg-mark"
            >
              <entry.icon aria-hidden className="size-icon shrink-0 text-muted" />
              {entry.label}
            </RadixMenu.Item>
          ))}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
