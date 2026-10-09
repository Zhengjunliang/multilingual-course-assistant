/**
 * The language menu: a globe and the language in use, opening on the languages
 * the product speaks, each written in itself.
 *
 * It exists in three frames and must not exist three times in the source. The
 * signed-in header writes the choice to the account (`User.locale`); the
 * sign-in pages and the visitor's header remember it on this screen only
 * (i18n/index.ts), because before a session there is nothing to write to.
 * That difference is the `onChange` each passes — everything a reader sees is
 * the same, and keeping it the same is exactly what copies would stop doing.
 *
 * A globe and a menu rather than a row of codes, the way MDN and GitHub Docs
 * offer their languages: a row grows with every language, and `zh-hans` means
 * nothing to a reader. Each language is named in itself — "Italiano",
 * "English", "简体中文" — by `Intl.DisplayNames`, so a reader finds their own
 * language whatever the page is in and no catalogue spells another language's
 * name; `lang` on each entry lets a screen reader say it in that language.
 *
 * Radix's radio items, not `dropdown-menu.tsx`: a language is one of a set, and
 * `menuitemradio` with `aria-checked` says which one is chosen, where the
 * avatar menu's entries are actions. The surface and the entries look the
 * same. The chosen language gets a check mark and no accent: the accent is for
 * what a reader is about to do, not a setting already true.
 *
 * `locales` is a prop rather than an import so that this file knows nothing
 * about which languages the product speaks.
 */

import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { Check, Globe } from "lucide-react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LocaleSwitchProps<T extends string> {
  locales: readonly T[];
  value: string;
  onChange: (locale: T) => void;
  /** Heads the menu and names the trigger for a screen reader, such as "Lingua". */
  label: string;
  className?: string;
}

/** A language's name in that language, capitalised as the start of an entry. */
function endonym(locale: string): string {
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

export function LocaleSwitch<T extends string>({
  locales,
  value,
  onChange,
  label,
  className,
}: LocaleSwitchProps<T>) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>
        <Button type="button" variant="ghost" size="sm" className={cn("gap-hair", className)}>
          <Globe aria-hidden className="size-icon" />
          <span className="sr-only">{label}</span>
          <span lang={value}>{endonym(value)}</span>
        </Button>
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="start"
          sideOffset={8}
          className="z-floating flex min-w-40 flex-col rounded-card border border-line bg-surface p-hair shadow-overlay"
        >
          <RadixMenu.Label className="px-tight py-hair text-caption text-muted">
            {label}
          </RadixMenu.Label>
          <RadixMenu.RadioGroup
            value={value}
            onValueChange={(next) => {
              const locale = locales.find((candidate) => candidate === next);
              if (locale !== undefined) onChange(locale);
            }}
          >
            {locales.map((locale) => (
              <RadixMenu.RadioItem
                key={locale}
                value={locale}
                lang={locale}
                className="flex cursor-default items-center gap-tight rounded-chip px-tight py-tight text-body text-ink outline-none data-highlighted:bg-mark"
              >
                <span className="flex size-icon shrink-0">
                  <RadixMenu.ItemIndicator>
                    <Check aria-hidden className="size-icon" />
                  </RadixMenu.ItemIndicator>
                </span>
                {endonym(locale)}
              </RadixMenu.RadioItem>
            ))}
          </RadixMenu.RadioGroup>
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
