/**
 * `/staff/editions`: every edition in the caller's scope, or, with
 * `?programme=<code>`, those of the courses one programme offers.
 */

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { useSearchParams } from "react-router-dom";

import { type Edition, listEditions } from "@/api/catalog";
import { useLoad } from "@/features/staff/context";
import { EditionTable } from "@/features/staff/EditionTable";
import { LoadFailure } from "@/features/staff/NotFound";
import { SetCurrentDialog } from "@/features/staff/SetCurrentDialog";

export default function EditionsPage() {
  const { t } = useTranslation();
  const [params] = useSearchParams();
  const programme = params.get("programme") ?? undefined;
  const load = useCallback(() => listEditions(programme), [programme]);
  const editions = useLoad(load);
  const [switching, setSwitching] = useState<Edition | null>(null);

  const replaced =
    switching === null
      ? null
      : (editions.data?.find(
          (e) => e.course.code === switching.course.code && e.is_current && e.id !== switching.id,
        ) ?? null);

  return (
    <section className="flex flex-col gap-snug">
      <header className="flex flex-col gap-hair">
        <h1 className="font-semibold text-ink text-title">{t("staff.editions.title")}</h1>
        {programme !== undefined && (
          <p className="text-body text-muted">{t("staff.editions.ofProgramme", { programme })}</p>
        )}
      </header>
      {editions.error !== null && <LoadFailure error={editions.error} />}
      {editions.data !== null && (
        <EditionTable editions={editions.data} onSetCurrent={setSwitching} />
      )}
      <SetCurrentDialog
        edition={switching}
        replaced={replaced}
        onClose={() => setSwitching(null)}
        onSwitched={editions.reload}
      />
    </section>
  );
}
