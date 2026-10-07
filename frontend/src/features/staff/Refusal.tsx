/**
 * What a staff page shows when its object cannot be read, and what a dialog
 * shows when a write it offered is refused for a missing permission.
 *
 * Outside the caller's scope the server answers 404, as if the object did not
 * exist, and the page says the same: "not found", never "not allowed", which
 * would tell a reader the object is there. The way back is the reader's own
 * start, which only the page knows (routes/shell.ts). Inside the scope
 * without the permission the server answers 403; the page offers an action
 * only where `permissions` holds it, so that 403 means the permissions
 * changed after the page read them, and the dialog names the one missing.
 */

import { ArrowLeft, Ban } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { Permission } from "@/api/catalog";
import { Mascot } from "@/components/Mascot";
import { Button, buttonVariants } from "@/components/ui/button";
import { isNotFound } from "./errors";

export interface Back {
  to: string;
  label: string;
}

export function NotFound({ back }: { back: Back }) {
  const { t } = useTranslation();
  return (
    <section className="flex flex-col items-start gap-snug py-room">
      <Mascot pose="notFound" className="size-mascot" />
      <div className="flex flex-col gap-hair">
        <h1 tabIndex={-1} className="font-semibold font-serif text-display text-ink outline-none">
          {t("staff.refusal.notFound")}
        </h1>
        <p className="text-body text-muted">{t("staff.refusal.notFoundBody")}</p>
      </div>
      <Link to={back.to} className={buttonVariants({ variant: "outline" })}>
        <ArrowLeft aria-hidden className="size-icon" />
        {back.label}
      </Link>
    </section>
  );
}

interface LoadFailureProps {
  error: unknown;
  back: Back;
  /** Reads the page again; offered beside a failure that is not "not found". */
  onRetry?: () => void;
}

/**
 * A page whose data did not load: not found for a 404; otherwise a sentence
 * and the button that reads it again, since what failed — the network, the
 * server — may answer the next time.
 */
export function LoadFailure({ error, back, onRetry }: LoadFailureProps) {
  const { t } = useTranslation();
  if (isNotFound(error)) return <NotFound back={back} />;
  return (
    <div role="alert" className="flex flex-wrap items-center gap-snug py-room">
      <p className="text-body text-warn-ink">{t("staff.loadFailed")}</p>
      {onRetry !== undefined && (
        <Button type="button" variant="outline" size="sm" onClick={onRetry}>
          {t("staff.retry")}
        </Button>
      )}
    </div>
  );
}

/** The sentence each write's missing permission comes with. */
const CANNOT: Partial<Record<Permission, string>> = {
  "edition.assign_teacher": "staff.refusal.cannot.assignTeacher",
  "programme.assign_secretariat": "staff.refusal.cannot.assignSecretariat",
  "edition.set_current": "staff.refusal.cannot.setCurrent",
};

export function Forbidden({ permission }: { permission: Permission }) {
  const { t } = useTranslation();
  return (
    <div
      role="alert"
      className="flex gap-tight rounded-control border border-warn-line bg-warn px-snug py-tight text-warn-ink"
    >
      <Ban aria-hidden className="mt-hair size-icon shrink-0" />
      <div className="flex flex-col gap-hair text-body">
        <p className="font-medium">
          {t("staff.refusal.forbidden")}: <code className="font-mono">{permission}</code>
        </p>
        {CANNOT[permission] !== undefined && <p>{t(CANNOT[permission])}</p>}
      </div>
    </div>
  );
}
