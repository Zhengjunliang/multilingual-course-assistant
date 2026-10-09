import { ArrowLeft, RotateCw } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { StatusPanel } from "@/components/StatusPanel";
import { Button, buttonVariants } from "@/components/ui/button";

/**
 * A page that threw while it was drawn, caught by the route that holds it
 * (App.tsx). Inside the frame, the sidebar and the header stay and the panel
 * takes the page's place, so the reader can go anywhere else at once; `full`
 * covers the window, for when the frame itself is what threw.
 *
 * Reload comes first: such an error usually comes from one state the page
 * was in, and a fresh load leaves it behind. The start is the way out when a
 * reload meets the same error. The router reports the error to the console
 * itself, and there is no service to send it to, so the panel never reads it.
 */
export default function RouteError({ full = false }: { full?: boolean }) {
  const { t } = useTranslation();

  return (
    <main
      className={
        full
          ? "flex min-h-full flex-col items-center justify-center px-gutter py-room"
          : "flex min-h-0 flex-1 flex-col items-center justify-center overflow-y-auto px-gutter py-room"
      }
    >
      <StatusPanel pose="error" heading={t("crash.title")} body={t("crash.body")} alert>
        <Button type="button" onClick={() => window.location.reload()}>
          <RotateCw aria-hidden className="size-icon" />
          {t("crash.reload")}
        </Button>
        <Link to="/" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden className="size-icon" />
          {t("crash.home")}
        </Link>
      </StatusPanel>
    </main>
  );
}
