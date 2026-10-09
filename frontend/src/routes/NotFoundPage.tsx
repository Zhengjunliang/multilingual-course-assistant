import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { StatusPanel } from "@/components/StatusPanel";
import { buttonVariants } from "@/components/ui/button";

/**
 * Any address the application does not have.
 *
 * Saying so, with the way back, is what a 404 is for: sending the reader to
 * `/` without a word would hide a mistyped or stale link, since they would land
 * on the chat and could not tell the link was wrong. Outside the session like
 * the sign-in pages, because a wrong address needs no account to be wrong; `/`
 * asks for one if it has to.
 */
export default function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-full flex-col items-center justify-center px-gutter py-room">
      <StatusPanel pose="notFound" heading={t("notFound.title")} body={t("notFound.body")}>
        <Link to="/" className={buttonVariants({ variant: "outline" })}>
          <ArrowLeft aria-hidden className="size-icon" />
          {t("notFound.home")}
        </Link>
      </StatusPanel>
    </main>
  );
}
