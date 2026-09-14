/**
 * The three-way language switch, in the one place both of its callers read.
 *
 * It exists twice on screen and must not exist twice in the source. The header
 * writes the choice to the account (`User.locale`); the login frame only tells
 * i18next, because before a session there is nothing to write to. That
 * difference is the `onChange` they each pass — everything a reader sees is the
 * same, and keeping it the same is exactly what two copies would stop doing.
 *
 * The accent is deliberately absent. `default` — the accent-filled variant —
 * would mark the language already in use, and the accent is reserved for what a
 * reader is about to *do*: send a question, open a source. A setting that is
 * merely already true gets ink and a quiet fill instead.
 *
 * `locales` is a prop rather than an import so that this file knows nothing
 * about which languages the product speaks.
 */

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export interface LocaleSwitchProps<T extends string> {
  locales: readonly T[];
  value: string;
  onChange: (locale: T) => void;
  className?: string;
}

export function LocaleSwitch<T extends string>({
  locales,
  value,
  onChange,
  className,
}: LocaleSwitchProps<T>) {
  return (
    <nav className={cn("flex gap-hair rounded-full bg-mark p-hair", className)}>
      {locales.map((locale) => {
        const active = value === locale;
        return (
          <Button
            key={locale}
            type="button"
            size="sm"
            variant={active ? "outline" : "ghost"}
            aria-pressed={active}
            className="rounded-full"
            onClick={() => onChange(locale)}
          >
            {locale}
          </Button>
        );
      })}
    </nav>
  );
}
