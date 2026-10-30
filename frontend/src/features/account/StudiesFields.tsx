/**
 * What a person says they study: a degree programme and its year, both
 * optional. Registration (routes/RegisterPage.tsx) and the account page
 * (`StudiesChoice`) draw the same two choices. The year is offered once a
 * programme is chosen, since the server takes no year alone
 * (apps/accounts/serializers.py), and choosing no programme clears it.
 */

import { useTranslation } from "react-i18next";

import type { Studies } from "@/api/account";
import type { ProgrammeName } from "@/api/catalog";
import { Select } from "@/components/ui/field";
import type { ErrorText } from "@/lib/errorText";

/** The ids of the two choices, which are also the fields the server names in a refusal. */
export const STUDIES_FIELDS = ["programme", "year_of_study"] as const;

// apps/catalog/models.py, `FIRST_YEAR_OF_STUDY` and `LAST_YEAR_OF_STUDY`.
const YEARS = [1, 2, 3, 4, 5, 6];

interface StudiesFieldsProps {
  /** Null while they are read: only "none" is offered. */
  programmes: readonly ProgrammeName[] | null;
  value: Studies;
  onChange: (next: Studies) => void;
  failure: ErrorText | null;
  hint?: string;
}

export function StudiesFields({ programmes, value, onChange, failure, hint }: StudiesFieldsProps) {
  const { t } = useTranslation();
  const none = { value: "", label: t("studies.none") };
  const errorOf = (field: (typeof STUDIES_FIELDS)[number]) => {
    const sentences = failure?.fieldSentences[field] ?? [];
    return sentences.length === 0
      ? undefined
      : sentences.map((sentence) => t(sentence.key, sentence.values)).join(" ");
  };

  return (
    <>
      <Select
        id="programme"
        label={t("studies.programme")}
        hint={hint}
        options={[
          none,
          ...(programmes ?? []).map((programme) => ({
            value: programme.code,
            label: programme.name,
            lang: programme.locale,
          })),
        ]}
        value={value.programme ?? ""}
        onChange={(event) => {
          const programme = event.target.value === "" ? null : event.target.value;
          onChange({ programme, year_of_study: programme === null ? null : value.year_of_study });
        }}
        error={errorOf("programme")}
      />
      {value.programme !== null && (
        <Select
          id="year_of_study"
          label={t("studies.year")}
          options={[
            none,
            ...YEARS.map((year) => ({ value: String(year), label: t("studies.yearN", { year }) })),
          ]}
          value={value.year_of_study === null ? "" : String(value.year_of_study)}
          onChange={(event) =>
            onChange({
              ...value,
              year_of_study: event.target.value === "" ? null : Number(event.target.value),
            })
          }
          error={errorOf("year_of_study")}
        />
      )}
    </>
  );
}
