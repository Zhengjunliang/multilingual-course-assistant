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
 *
 * A page that cannot be read is the status panel every such screen is
 * (components/StatusPanel.tsx), with a lock in its disc rather than the
 * cat: the page is out of the reader's reach, which is not the same as an
 * address the application does not have. Its code is on a chip; the ways on
 * are the reader's own start and a new conversation, or, for a failure that
 * may pass, reading the page again and the start.
 */

import { ArrowLeft, Ban, CircleAlert, Lock, RotateCw, SquarePen } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import type { Permission } from "@/api/catalog";
import { ApiError } from "@/api/http";
import { StatusPanel } from "@/components/StatusPanel";
import { Banner } from "@/components/ui/banner";
import { Button, buttonVariants } from "@/components/ui/button";
import { isNotFound } from "./errors";

export interface Back {
  to: string;
  label: string;
}

/** The way back to the reader's own start, as a link drawn as a button. */
function BackLink({ back, variant }: { back: Back; variant: "primary" | "outline" }) {
  return (
    <Link to={back.to} className={buttonVariants({ variant })}>
      <ArrowLeft aria-hidden className="size-icon" />
      {back.label}
    </Link>
  );
}

export function NotFound({ back }: { back: Back }) {
  const { t } = useTranslation();
  return (
    <div className="flex justify-center py-room">
      <StatusPanel
        icon={Lock}
        code="404"
        heading={t("staff.refusal.notFound")}
        body={t("staff.refusal.notFoundBody")}
      >
        <BackLink back={back} variant="primary" />
        <Link to="/" className={buttonVariants({ variant: "ghost" })}>
          <SquarePen aria-hidden className="size-icon" />
          {t("sidebar.new")}
        </Link>
      </StatusPanel>
    </div>
  );
}

interface LoadFailureProps {
  error: unknown;
  back: Back;
  /** Reads the page again; offered beside a failure that is not "not found". */
  onRetry?: () => void;
}

/**
 * A page whose data did not load: not found for a 404; otherwise the
 * warning's panel, with the status the server answered where there was one,
 * and the button that reads the page again first, since what failed — the
 * network, the server — may answer the next time.
 */
export function LoadFailure({ error, back, onRetry }: LoadFailureProps) {
  const { t } = useTranslation();
  if (isNotFound(error)) return <NotFound back={back} />;
  return (
    <div className="flex justify-center py-room">
      <StatusPanel
        icon={CircleAlert}
        tone="warn"
        alert
        code={error instanceof ApiError ? String(error.status) : undefined}
        heading={t("staff.failure.title")}
        body={t("staff.failure.body")}
      >
        {onRetry !== undefined && (
          <Button type="button" onClick={onRetry}>
            <RotateCw aria-hidden className="size-icon" />
            {t("staff.retry")}
          </Button>
        )}
        <BackLink back={back} variant={onRetry === undefined ? "primary" : "outline"} />
      </StatusPanel>
    </div>
  );
}

/** The sentence each write's missing permission comes with. */
const CANNOT: Partial<Record<Permission, string>> = {
  "edition.assign_teacher": "staff.refusal.cannot.assignTeacher",
  "programme.assign_secretariat": "staff.refusal.cannot.assignSecretariat",
};

export function Forbidden({ permission }: { permission: Permission }) {
  const { t } = useTranslation();
  const cannot = CANNOT[permission];
  return (
    <Banner
      tone="warn"
      role="alert"
      icon={Ban}
      heading={`${t("staff.refusal.forbidden")}: ${permission}`}
    >
      {cannot === undefined ? undefined : t(cannot)}
    </Banner>
  );
}
