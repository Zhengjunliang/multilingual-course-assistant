/**
 * What a refused form shows (#186), for every form that sets a password: the
 * registration, an invitation's, a reset link's and the account's own change.
 * Under each field the server named, its sentences, tied to the field by
 * `aria-describedby`; and an alert for a refusal no field carries, a 429, or
 * one to report, whose code and request id no field's message has room for.
 * Rendered from the `ErrorText` rather than when the refusal arrived, so a
 * change of language rewords it.
 *
 * A refusal that names fields puts the focus in the first of them, once its
 * messages describe it, as the login page puts it in its password. Each
 * field's input has the field's name as its id.
 */

import { type ReactNode, useEffect } from "react";
import { useTranslation } from "react-i18next";

import { FieldError } from "@/components/ui/field";
import type { ErrorText } from "@/lib/errorText";

const about = (field: string) => `${field}-refused`;

export interface FormRefusal {
  refused: (field: string) => boolean;
  /** The ids that describe `field`: its hint, when it has one, and its refusal. */
  describedBy: (field: string, hint?: string) => string | undefined;
  /** The field's sentences, to put under it. */
  lines: (field: string) => ReactNode;
  /** What no field carries, to put above the button. */
  alert: ReactNode;
}

/** `fields` must keep its identity across renders: a module's constant. */
export function useFormRefusal(failure: ErrorText | null, fields: readonly string[]): FormRefusal {
  const { t } = useTranslation();
  const sentencesFor = (field: string) => failure?.fieldSentences[field] ?? [];
  const refused = (field: string) => sentencesFor(field).length > 0;

  useEffect(() => {
    const first = fields.find((field) => (failure?.fieldSentences[field] ?? []).length > 0);
    if (first !== undefined) document.getElementById(first)?.focus();
  }, [failure, fields]);

  const shownAlone = failure !== null && (failure.reference !== null || !fields.some(refused));
  return {
    refused,
    describedBy: (field, hint) =>
      [hint, refused(field) ? about(field) : undefined].filter(Boolean).join(" ") || undefined,
    lines: (field) =>
      refused(field) && (
        <div id={about(field)} className="flex flex-col gap-hair">
          {sentencesFor(field).map((sentence) => (
            <FieldError key={JSON.stringify(sentence)}>
              {t(sentence.key, sentence.values)}
            </FieldError>
          ))}
        </div>
      ),
    alert: shownAlone && (
      <FieldError
        role="alert"
        reference={
          failure.reference ? t(failure.reference.key, failure.reference.values) : undefined
        }
      >
        {t(failure.sentence.key, failure.sentence.values)}
      </FieldError>
    ),
  };
}
