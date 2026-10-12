/**
 * The menu behind the account: a head saying who is signed in, then its
 * items in sections.
 *
 * Ported from shadcn/ui (MIT, github.com/shadcn-ui/ui) and rewritten on this
 * repository's tokens: upstream paints with `bg-popover`, `border-border` and
 * `text-popover-foreground`, none of which exist here. What is *not* ported is
 * the shape. Upstream exports a dozen names, Root, Trigger, Content, Item and
 * the rest, and this interface composes one menu; the parts would be code
 * nothing runs, which is the definition rule 6 gives for noise, and
 * `StyleguidePage.test.tsx` would demand a specimen for each. `sheet.tsx` set
 * the precedent: wrap the Radix parts a component needs and export that
 * component, described by data.
 *
 * What comes from Radix is the part worth taking: roving focus with the arrow
 * keys, `Escape`, dismissal on an outside press, `aria-haspopup` wired to the
 * trigger, a submenu that opens with the right arrow, and focus returned to
 * the trigger on close. Those are the parts a hand-rolled menu gets wrong.
 *
 * How it is drawn (#190): a section may have a label, 32 px items with their
 * key at the right (`aria-keyshortcuts` on the item, the cap hidden), rules
 * from edge to edge between sections, and the item under the pointer in the
 * accent at 6 %. A choice, such as the language, is a submenu whose row shows
 * the current value; its options are radios with a check on the chosen one,
 * never the accent, since a setting that is true is not where the reader is.
 */

import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronRight, type LucideIcon } from "lucide-react";
import { Fragment, type ReactNode, useId } from "react";

import { Kbd, type Shortcut } from "@/components/ui/kbd";

interface MenuAction {
  /** Stable across renders and across languages, so not the label. */
  key: string;
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
  shortcut?: Shortcut;
}

interface MenuChoice {
  key: string;
  icon: LucideIcon;
  label: string;
  /** The option chosen, whose label the row shows. */
  value: string;
  options: readonly { value: string; label: string; lang?: string }[];
  onValueChange: (value: string) => void;
}

interface MenuSection {
  key: string;
  /** A small heading over the section's items. */
  label?: string;
  items: readonly (MenuAction | MenuChoice)[];
}

interface DropdownMenuProps {
  /** Rendered as the trigger itself, so it must accept a ref and DOM props. */
  trigger: ReactNode;
  /** Screen-reader name for the trigger. */
  ariaLabel: string;
  /** Above the sections: who is signed in. */
  head?: ReactNode;
  sections: readonly MenuSection[];
  /**
   * After the menu has closed and given focus back to the trigger.
   *
   * Exposed because opening a dialog from an item's `onSelect` puts two
   * components in a race for the focus at once; waiting until the menu has
   * finished is the only ordering that does not depend on timing.
   */
  onCloseAutoFocus?: () => void;
}

const ITEM =
  "flex h-control-sm cursor-default items-center gap-tight rounded-chip px-tight text-body text-ink outline-none data-highlighted:bg-hover";
const SURFACE =
  "z-floating flex min-w-56 flex-col rounded-card border border-line bg-surface p-hair shadow-overlay";
const RULE = "-mx-hair my-hair h-px bg-line";

function Choice({ item }: { item: MenuChoice }) {
  const current = item.options.find((option) => option.value === item.value);
  return (
    <RadixMenu.Sub>
      <RadixMenu.SubTrigger className={`${ITEM} data-[state=open]:bg-hover`}>
        <item.icon aria-hidden className="size-icon shrink-0 text-muted" />
        <span className="flex-1">{item.label}</span>
        <span lang={current?.lang} className="text-caption text-muted">
          {current?.label}
        </span>
        <ChevronRight aria-hidden className="size-icon shrink-0 text-muted" />
      </RadixMenu.SubTrigger>
      <RadixMenu.Portal>
        <RadixMenu.SubContent sideOffset={6} className={SURFACE}>
          <RadixMenu.RadioGroup value={item.value} onValueChange={item.onValueChange}>
            {item.options.map((option) => (
              <RadixMenu.RadioItem key={option.value} value={option.value} className={ITEM}>
                <span lang={option.lang} className="flex-1">
                  {option.label}
                </span>
                <RadixMenu.ItemIndicator>
                  <Check aria-hidden className="size-icon" />
                </RadixMenu.ItemIndicator>
              </RadixMenu.RadioItem>
            ))}
          </RadixMenu.RadioGroup>
        </RadixMenu.SubContent>
      </RadixMenu.Portal>
    </RadixMenu.Sub>
  );
}

export function DropdownMenu({
  trigger,
  ariaLabel,
  head,
  sections,
  onCloseAutoFocus,
}: DropdownMenuProps) {
  const id = useId();
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
          className={SURFACE}
        >
          {head !== undefined && (
            <>
              <RadixMenu.Label className="px-tight py-tight">{head}</RadixMenu.Label>
              <RadixMenu.Separator className={RULE} />
            </>
          )}
          {sections.map((section, index) => (
            <Fragment key={section.key}>
              {index > 0 && <RadixMenu.Separator className={RULE} />}
              <RadixMenu.Group
                aria-labelledby={section.label === undefined ? undefined : `${id}-${section.key}`}
              >
                {section.label !== undefined && (
                  <RadixMenu.Label
                    id={`${id}-${section.key}`}
                    className="px-tight pt-tight pb-hair font-semibold text-caption text-muted uppercase"
                  >
                    {section.label}
                  </RadixMenu.Label>
                )}
                {section.items.map((item) =>
                  "options" in item ? (
                    <Choice key={item.key} item={item} />
                  ) : (
                    <RadixMenu.Item
                      key={item.key}
                      onSelect={item.onSelect}
                      aria-keyshortcuts={item.shortcut?.keys}
                      className={ITEM}
                    >
                      <item.icon aria-hidden className="size-icon shrink-0 text-muted" />
                      <span className="flex-1">{item.label}</span>
                      {item.shortcut !== undefined && <Kbd>{item.shortcut.label}</Kbd>}
                    </RadixMenu.Item>
                  ),
                )}
              </RadixMenu.Group>
            </Fragment>
          ))}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
