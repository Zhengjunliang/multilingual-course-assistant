import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { AuthLayout } from "./AuthLayout";

/**
 * `/forgot`: what to do about a forgotten password. The site sends no mail
 * (#220), so it cannot send a link either: the superuser makes one and hands
 * it over (routes/ResetPage.tsx), and the page says whom to ask.
 */
export default function ForgotPage() {
  const { t } = useTranslation();
  return (
    <AuthLayout
      heading={t("auth.forgotTitle")}
      refusals={0}
      phase="idle"
      footer={
        <Link to="/login" className="font-medium text-ink underline">
          {t("auth.backToLogIn")}
        </Link>
      }
    >
      <p className="text-center text-body text-ink">{t("auth.forgotBody")}</p>
    </AuthLayout>
  );
}
