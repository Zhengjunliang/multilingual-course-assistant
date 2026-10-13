/**
 * What keeps a syllabus half written from being lost on the way out, while
 * `unsaved` sections hold text not saved. Closing or reloading the tab asks
 * through the browser's own prompt, whose words no page sets (outside the
 * repository: MDN, "Window: beforeunload event"); a move to another page of
 * the site asks here, and the reader stays or leaves without saving. A move
 * that keeps the page, a query changed, is let through: the boxes stay.
 * Staying gives the focus back to what had it when the move was held, the
 * link the reader followed: Radix gives it back to a dialog's trigger, and
 * this one has none.
 */

import { LogOut } from "lucide-react";
import { useEffect, useRef } from "react";
import { useTranslation } from "react-i18next";
import { useBlocker } from "react-router-dom";

import { AlertDialog } from "@/components/ui/alert-dialog";

export function LeaveGuard({ unsaved }: { unsaved: number }) {
  const { t } = useTranslation();
  const asking = unsaved > 0;
  const opener = useRef<HTMLElement | null>(null);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    if (!asking || currentLocation.pathname === nextLocation.pathname) return false;
    opener.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    return true;
  });

  useEffect(() => {
    if (!asking) return;
    const ask = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      // Chrome and Edge before 119 ask only when it is set.
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", ask);
    return () => window.removeEventListener("beforeunload", ask);
  }, [asking]);

  return (
    <AlertDialog
      open={blocker.state === "blocked"}
      // Also called once «Esci» has sent the move on, whose end idles the
      // blocker anyway: the reset only does it first.
      onOpenChange={(open) => {
        if (!open) blocker.reset?.();
      }}
      heading={t("staff.syllabus.leave.title")}
      icon={LogOut}
      description={t("staff.syllabus.leave.body", { count: unsaved })}
      cancelLabel={t("staff.syllabus.leave.stay")}
      confirmLabel={t("staff.syllabus.leave.action")}
      onConfirm={async () => {
        blocker.proceed?.();
        return true;
      }}
      destructive
      onCloseAutoFocus={(event) => {
        event.preventDefault();
        opener.current?.focus();
      }}
    />
  );
}
