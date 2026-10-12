/**
 * Where a finished action says it is done: a toast in the corner, gone after a
 * few seconds, the shadcn/ui wrapper of Sonner (outside the repository: ui.shadcn.com,
 * "Sonner").
 *
 * A toast and not a line on the page: the page has moved on — a dialog
 * closed, a row changed — and the confirmation belongs to no part of it.
 * Sonner reads each toast out in a polite live region of its own, so it is
 * heard without taking focus. It is drawn here rather than by Sonner's own
 * styles (#190): the ink ground, the inverse of the page as a tooltip is, an
 * icon in a disc, and two lines, what happened in its weight and the object
 * it happened to under it (`toast.success(result, { description: object })`).
 * A failure (`toast.error`) has the warning's disc and, when the caller gives
 * one, an action such as «Riprova», outlined in the toast's lettering. Its
 * theme follows the one painted; outside a `ThemeProvider`, as on
 * /styleguide, which paints both themes itself, it follows the system.
 *
 * The description's colour is marked important: Sonner injects a rule outside
 * any layer, which `unstyled` does not turn off, that sets a dark-themed
 * toast's description to a near-white, and an unlayered rule beats every
 * utility. On the ink ground of the dark theme, which is light, it vanished.
 *
 * Sonner keeps its toasts in one store for the whole page and shows those
 * still open to the next Toaster that mounts, so this one dismisses them as it
 * goes: a toast shown just before signing out would greet the next sign-in.
 *
 * The live region is named in the interface's language; Sonner's own name is
 * English, and it appends the shortcut that reaches the region.
 */

import { Check, CircleAlert } from "lucide-react";
import { useContext, useEffect } from "react";
import { useTranslation } from "react-i18next";
import { Toaster as Sonner, toast } from "sonner";

import { ThemeContext } from "@/theme/ThemeProvider";

export function Toaster() {
  const { t } = useTranslation();
  const theme = useContext(ThemeContext);
  useEffect(() => () => void toast.dismiss(), []);
  return (
    <Sonner
      theme={theme?.resolved ?? "system"}
      position="bottom-right"
      containerAriaLabel={t("app.notifications")}
      icons={{
        success: (
          <span className="grid size-icon-lg place-items-center rounded-full bg-accent-soft text-accent">
            <Check aria-hidden className="size-icon" />
          </span>
        ),
        error: (
          <span className="grid size-icon-lg place-items-center rounded-full bg-warn text-warn-ink">
            <CircleAlert aria-hidden className="size-icon" />
          </span>
        ),
      }}
      toastOptions={{
        unstyled: true,
        classNames: {
          toast:
            "flex w-(--width) items-center gap-snug rounded-card bg-ink px-snug py-tight text-canvas shadow-overlay",
          icon: "shrink-0",
          content: "flex min-w-0 flex-1 flex-col",
          title: "font-semibold text-body",
          description: "text-caption text-canvas!",
          actionButton:
            "h-control-xs shrink-0 rounded-control border border-current/40 px-tight font-medium text-caption transition-colors hover:bg-canvas/10",
        },
      }}
    />
  );
}
