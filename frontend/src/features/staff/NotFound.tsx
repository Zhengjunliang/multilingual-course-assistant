/**
 * What a staff page shows when its object cannot be read. Outside the caller's
 * scope the server answers 404, as if the object did not exist, and the page
 * says the same: "not found", never "not allowed", which would tell a reader
 * the object is there.
 */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { isNotFound } from "./errors";

export function NotFound() {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col gap-tight">
      <h1 className="font-semibold text-ink text-title">{t("staff.notFound.title")}</h1>
      <p className="text-body text-muted">{t("staff.notFound.body")}</p>
      <Link to="/staff/editions" className="self-start text-body text-ink underline">
        {t("staff.notFound.back")}
      </Link>
    </section>
  );
}

/** A page whose data did not load: not found for a 404, a general sentence otherwise. */
export function LoadFailure({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (isNotFound(error)) return <NotFound />;
  return <p className="text-body text-warn-ink">{t("staff.loadFailed")}</p>;
}
