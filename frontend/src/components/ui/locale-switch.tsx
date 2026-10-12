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
 * Each row also shows the language's code on a chip, which the trigger
 * carries too, and its name in the interface's language after its own, so a
 * reader who does not know "简体中文" learns it is Chinese (#190); both names
 * come from `Intl.DisplayNames`, and the second is left out where it would
 * repeat the first. The code is hidden from a screen reader, which hears
 * the names. `hint`, under the rows, says what the choice does not change:
 * an answer follows the language of its question, not the interface's.
 *
 * `locales` is a prop rather than an import so that this file knows nothing
 * about which languages the product speaks.
 */

import * as RadixMenu from "@radix-ui/react-dropdown-menu";
import { Check, ChevronDown, Globe } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { cn } from "@/lib/utils";

interface LocaleSwitchProps<T extends string> {
  locales: readonly T[];
  value: string;
  onChange: (locale: T) => void;
  /** Heads the menu and names the trigger for a screen reader, such as "Lingua". */
  label: string;
  /** One line under the languages, on what the choice does not change. */
  hint?: string;
  className?: string;
}

/** A language's name in that language, capitalised as the start of an entry. */
function endonym(locale: string): string {
  const name = new Intl.DisplayNames([locale], { type: "language" }).of(locale) ?? locale;
  return name.charAt(0).toLocaleUpperCase(locale) + name.slice(1);
}

/** A language's name in the interface's language `ui`. */
function inLanguage(locale: string, ui: string): string {
  return new Intl.DisplayNames([ui], { type: "language" }).of(locale) ?? locale;
}

/** The language's own code, as a chip shows it: "zh-hans" is ZH. */
function code(locale: string): string {
  return (locale.split("-")[0] ?? locale).toUpperCase();
}

export function LocaleSwitch<T extends string>({
  locales,
  value,
  onChange,
  label,
  hint,
  className,
}: LocaleSwitchProps<T>) {
  return (
    <RadixMenu.Root>
      <RadixMenu.Trigger asChild>
        <Button type="button" variant="ghost" size="sm" className={cn("gap-hair", className)}>
          <Globe aria-hidden className="size-icon" />
          <span className="sr-only">{label}</span>
          <Chip size="sm" aria-hidden>
            {code(value)}
          </Chip>
          <span lang={value}>{endonym(value)}</span>
          <ChevronDown aria-hidden className="size-icon" />
        </Button>
      </RadixMenu.Trigger>
      <RadixMenu.Portal>
        <RadixMenu.Content
          align="start"
          sideOffset={8}
          className="z-floating flex min-w-56 flex-col rounded-card border border-line bg-surface p-hair shadow-overlay"
        >
          <RadixMenu.Label className="px-tight pt-tight pb-hair font-semibold text-caption text-muted uppercase">
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
                className="flex h-control-sm cursor-default items-center gap-tight rounded-chip px-tight text-body text-ink outline-none data-highlighted:bg-hover"
              >
                <Chip size="sm" aria-hidden>
                  {code(locale)}
                </Chip>
                <span lang={locale}>{endonym(locale)}</span>
                <span className="flex-1 text-caption text-muted">
                  {inLanguage(locale, value).toLocaleLowerCase(value) ===
                  endonym(locale).toLocaleLowerCase(value)
                    ? ""
                    : inLanguage(locale, value)}
                </span>
                <span className="flex size-icon shrink-0">
                  <RadixMenu.ItemIndicator>
                    <Check aria-hidden className="size-icon" />
                  </RadixMenu.ItemIndicator>
                </span>
              </RadixMenu.RadioItem>
            ))}
          </RadixMenu.RadioGroup>
          {hint !== undefined && (
            <>
              <RadixMenu.Separator className="-mx-hair my-hair h-px bg-line" />
              <RadixMenu.Label className="max-w-56 px-tight py-hair text-caption text-muted">
                {hint}
              </RadixMenu.Label>
            </>
          )}
        </RadixMenu.Content>
      </RadixMenu.Portal>
    </RadixMenu.Root>
  );
}
