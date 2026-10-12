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
 *
 * In a narrow drawer (`inline`, #191) a submenu would open past the screen's
 * edge, so the choice's row opens its options in place instead, under it and
 * indented, as the prototype's phone menu does; the row says so with
 * `aria-expanded`. The menu opens on any side of its trigger (`side`,
 * `align`): above the sidebar's account row, to the right of the rail's
 * avatar.
 */

import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, ChevronRight, type LucideIcon } from "lucide-react";
import { Fragment, type ReactNode, useId, useRef, useState } from "react";

import { Chip } from "@/components/ui/chip";
import { Kbd, type Shortcut } from "@/components/ui/kbd";
import { Tooltip } from "@/components/ui/tooltip";
import { cn } from "@/lib/utils";

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
  /** `code`, when there is one, is shown on a chip before the label, as a language's is. */
  options: readonly { value: string; label: string; lang?: string; code?: string }[];
  onValueChange: (value: string) => void;
}

interface MenuSection {
  key: string;
  /** A small heading over the section's items. */
  label?: string;
  items: readonly (MenuAction | MenuChoice)[];
}

interface DropdownMenuProps {
  /** Rendered inside the trigger, which is a button of the menu's own. */
  trigger: ReactNode;
  /**
   * The trigger's classes, for a trigger that is a whole row rather than an
   * avatar; a round focus ring otherwise.
   */
  triggerClassName?: string;
  /**
   * Screen-reader name for a trigger that shows no words, such as an avatar
   * alone. Left out when the trigger's own text names it, which a label would
   * otherwise override.
   */
  ariaLabel?: string;
  side?: "top" | "right" | "bottom";
  align?: "start" | "end";
  /** Choices open in place under their row rather than in a submenu. */
  inline?: boolean;
  /** As wide as the trigger, for a trigger that is a whole row. */
  fitTrigger?: boolean;
  /** A hint at the trigger's right (`Tooltip`), for a trigger that shows no words. */
  hint?: string;
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

/** The choice's row: its icon, its label and the option chosen. */
function ChoiceRow({ item, chevron }: { item: MenuChoice; chevron: LucideIcon }) {
  const current = item.options.find((option) => option.value === item.value);
  const Chevron = chevron;
  return (
    <>
      <item.icon aria-hidden className="size-icon shrink-0 text-muted" />
      <span className="flex-1">{item.label}</span>
      <span lang={current?.lang} className="text-caption text-muted">
        {current?.label}
      </span>
      <Chevron aria-hidden className="size-icon shrink-0 text-muted" />
    </>
  );
}

function Options({ item, className }: { item: MenuChoice; className?: string }) {
  return (
    <RadixMenu.RadioGroup
      value={item.value}
      onValueChange={item.onValueChange}
      className={className}
    >
      {item.options.map((option) => (
        <RadixMenu.RadioItem key={option.value} value={option.value} className={ITEM}>
          {option.code !== undefined && (
            <Chip size="sm" aria-hidden>
              {option.code}
            </Chip>
          )}
          <span lang={option.lang} className="flex-1">
            {option.label}
          </span>
          <RadixMenu.ItemIndicator>
            <Check aria-hidden className="size-icon" />
          </RadixMenu.ItemIndicator>
        </RadixMenu.RadioItem>
      ))}
    </RadixMenu.RadioGroup>
  );
}

function Choice({ item }: { item: MenuChoice }) {
  const [open, setOpen] = useState(false);
  const row = useRef<HTMLDivElement>(null);
  return (
    <RadixMenu.Sub open={open} onOpenChange={setOpen}>
      <RadixMenu.SubTrigger ref={row} className={`${ITEM} data-[state=open]:bg-hover`}>
        <ChoiceRow item={item} chevron={ChevronRight} />
      </RadixMenu.SubTrigger>
      <RadixMenu.Portal>
        <RadixMenu.SubContent
          sideOffset={6}
          // Escape closes the submenu alone and gives the focus back to its
          // row, as the WAI-ARIA menu pattern has it (outside the repository:
          // APG, "Menu and Menubar"); Radix would close the whole menu.
          onEscapeKeyDown={(event) => {
            event.preventDefault();
            setOpen(false);
            row.current?.focus();
          }}
          className={SURFACE}
        >
          <Options item={item} />
        </RadixMenu.SubContent>
      </RadixMenu.Portal>
    </RadixMenu.Sub>
  );
}

function InlineChoice({ item }: { item: MenuChoice }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <RadixMenu.Item
        aria-expanded={open}
        // Opening the options is not a choice made, so the menu stays open.
        onSelect={(event) => {
          event.preventDefault();
          setOpen((now) => !now);
        }}
        className={cn(ITEM, open && "bg-hover")}
      >
        <ChoiceRow item={item} chevron={open ? ChevronDown : ChevronRight} />
      </RadixMenu.Item>
      {/* Indented by the row's icon and gap, so the options line up under its label. */}
      {open && <Options item={item} className="ps-room" />}
    </>
  );
}

export function DropdownMenu({
  trigger,
  triggerClassName,
  ariaLabel,
  side = "bottom",
  align = "end",
  inline = false,
  fitTrigger = false,
  hint,
  head,
  sections,
  onCloseAutoFocus,
}: DropdownMenuProps) {
  const id = useId();
  const ChoiceItem = inline ? InlineChoice : Choice;
  const button = (
    <RadixMenu.Trigger
      aria-label={ariaLabel}
      className={
        triggerClassName ??
        "rounded-full focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2"
      }
    >
      {trigger}
    </RadixMenu.Trigger>
  );
  return (
    <RadixMenu.Root>
      {hint === undefined ? (
        button
      ) : (
        <Tooltip content={hint} side="right">
          {button}
        </Tooltip>
      )}
      <RadixMenu.Portal>
        <RadixMenu.Content
          side={side}
          align={align}
          sideOffset={8}
          onCloseAutoFocus={() => onCloseAutoFocus?.()}
          className={cn(SURFACE, fitTrigger && "w-(--radix-dropdown-menu-trigger-width)")}
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
                    <ChoiceItem key={item.key} item={item} />
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
