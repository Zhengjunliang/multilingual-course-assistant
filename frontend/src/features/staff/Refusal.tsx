/**
 * What a staff page shows when its object cannot be read.
 *
 * Outside the caller's scope the server answers 404, as if the object did not
 * exist, and the page says the same: "not found", never "not allowed", which
 * would tell a reader the object is there. The way back is the reader's own
 * start, which only the page knows (routes/shell.ts).
 */

import { ArrowLeft, SearchX } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { isNotFound } from "./errors";

export interface Back {
  to: string;
  label: string;
}

export function NotFound({ back }: { back: Back }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col items-start gap-snug py-room">
      <span className="flex size-control rounded-full bg-mark text-muted">
        <SearchX aria-hidden className="m-auto size-icon-lg" />
      </span>
      <div className="flex flex-col gap-hair">
        <h1 tabIndex={-1} className="font-semibold text-display text-ink outline-none">
          {t("staff.refusal.notFound")}
        </h1>
        <p className="text-body text-muted">{t("staff.refusal.notFoundBody")}</p>
      </div>
      <Link
        to={back.to}
        className="inline-flex h-control items-center gap-tight rounded-md border border-line px-gutter font-medium text-body text-ink transition-colors hover:bg-mark"
      >
        <ArrowLeft aria-hidden className="size-icon" />
        {back.label}
      </Link>
    </section>
  );
}

/** A page whose data did not load: not found for a 404, a general sentence otherwise. */
export function LoadFailure({ error, back }: { error: unknown; back: Back }) {
  const { t } = useTranslation();
  if (isNotFound(error)) return <NotFound back={back} />;
  return <p className="text-body text-warn-ink">{t("staff.loadFailed")}</p>;
}
