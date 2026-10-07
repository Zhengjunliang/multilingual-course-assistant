import { ArrowLeft } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { Mascot } from "@/components/Mascot";
import { buttonVariants } from "@/components/ui/button";

/**
 * Any address the application does not have.
 *
 * It used to send the reader to `/` without a word, which hides a mistyped or
 * stale link: the reader lands on the chat and cannot tell the link was wrong.
 * Saying so, with the way back, is what a 404 is for. Outside the session
 * like the sign-in pages, because a wrong address needs no account to be
 * wrong; `/` asks for one if it has to.
 */
export default function NotFoundPage() {
  const { t } = useTranslation();

  return (
    <main className="flex min-h-full flex-col items-center justify-center gap-room px-gutter py-room text-center">
      <Mascot pose="notFound" className="size-mascot" />
      <div className="flex max-w-sm flex-col gap-hair">
        <h1 className="font-semibold font-serif text-display text-ink">{t("notFound.title")}</h1>
        <p className="text-body text-muted">{t("notFound.body")}</p>
      </div>
      <Link to="/" className={buttonVariants({ variant: "outline" })}>
        <ArrowLeft aria-hidden className="size-icon" />
        {t("notFound.home")}
      </Link>
    </main>
  );
}
