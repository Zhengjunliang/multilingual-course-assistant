/**
 * A link that works once, shown the one time it exists: a reset link a
 * superuser made, or an invitation (#167). The server keeps only its digest
 * (apps/accounts/links.py), so closing this dialog loses it, and a lost one
 * is replaced by making another; the dialog says so, beside when it stops
 * working, as GitHub shows a new token once (outside the repository).
 *
 * The link in a read-only field, all of it selected when the field takes
 * the focus, and the copy button beside it, which has the focus as the
 * dialog opens and shows its tick for a while (features/chat/useCopy.ts).
 * The token is in the address's fragment, which a browser does not send to
 * a server (outside the repository: RFC 3986, section 3.5), so no log of
 * the site records it.
 */

import { Check, Copy, Link2 } from "lucide-react";
import { useId } from "react";
import { useTranslation } from "react-i18next";

import { Button } from "@/components/ui/button";
import { Dialog } from "@/components/ui/dialog";
import { Field } from "@/components/ui/field";
import { useCopy } from "@/features/chat/useCopy";

/** A link just made: the page that takes it, its token, and when it stops working. */
export interface Shown {
  path: "/reset" | "/invite";
  token: string;
  expires_at: string;
}

/** The address a link is handed over as. */
export function linkAddress({ path, token }: Shown): string {
  return `${window.location.origin}${path}#${token}`;
}

interface OneTimeLinkProps {
  /** The link; null while the dialog is closed. */
  shown: Shown | null;
  heading: string;
  /** Who or what the link is for, under the heading. */
  description: string;
  onClose: () => void;
  onCloseAutoFocus?: (event: Event) => void;
}

export function OneTimeLink({
  shown,
  heading,
  description,
  onClose,
  onCloseAutoFocus,
}: OneTimeLinkProps) {
  const { t, i18n } = useTranslation();
  const fieldId = useId();
  const { copied, copy } = useCopy();
  const address = shown === null ? "" : linkAddress(shown);
  const until =
    shown === null
      ? ""
      : new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(
          new Date(shown.expires_at),
        );

  return (
    <Dialog
      open={shown !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
      heading={heading}
      description={description}
      icon={Link2}
      closeLabel={t("staff.link.done")}
      onCloseAutoFocus={onCloseAutoFocus}
      footer={
        <Button type="button" onClick={onClose}>
          {t("staff.link.done")}
        </Button>
      }
    >
      <div className="flex items-end gap-tight">
        <div className="min-w-0 flex-1">
          <Field
            id={fieldId}
            label={t("staff.link.label")}
            readOnly
            value={address}
            onFocus={(event) => event.currentTarget.select()}
            className="font-mono"
          />
        </div>
        <Button
          type="button"
          variant="outline"
          // Where a reader goes the moment the link appears.
          autoFocus
          onClick={() => void copy(address)}
        >
          {copied ? (
            <Check aria-hidden className="size-icon" />
          ) : (
            <Copy aria-hidden className="size-icon" />
          )}
          {copied ? t("staff.link.copied") : t("staff.link.copy")}
        </Button>
        <span role="status" className="sr-only">
          {copied ? t("staff.link.copied") : ""}
        </span>
      </div>
      <p className="text-body text-muted">{t("staff.link.once", { date: until })}</p>
    </Dialog>
  );
}
