import { type FormEvent, useState } from "react";
import { useTranslation } from "react-i18next";
import { Link, Navigate } from "react-router-dom";

import { listProgrammes, type Studies } from "@/api/account";
import { useSession } from "@/auth/useSession";
import { useFormRefusal } from "@/components/FormRefusal";
import { STUDIES_FIELDS, StudiesFields } from "@/features/account/StudiesFields";
import { useLoad } from "@/features/staff/context";
import { DEFAULT_UI_LOCALE, isUiLocale, type UiLocale } from "@/i18n";
import { describeError, type ErrorText } from "@/lib/errorText";
import { AuthButton, AuthLayout, NewAccountFields } from "./AuthLayout";
import { useLanding } from "./landing";

const FIELDS = ["username", "password", ...STUDIES_FIELDS];

export default function RegisterPage() {
  const { t, i18n } = useTranslation();
  const { account, register } = useSession();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  // Optional, and what the account's questions search by default (apps/qa/scope.py).
  const [studies, setStudies] = useState<Studies>({ programme: null, year_of_study: null });
  const programmes = useLoad(listProgrammes);
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const landing = useLanding("/");
  const refusal = useFormRefusal(failure, FIELDS);

  if (account !== null && landing.phase === "idle") return <Navigate to="/" replace />;

  // Whatever language they are reading this page in becomes the account's, so
  // the first answer arrives in it without a settings page being found first.
  const locale: UiLocale = isUiLocale(i18n.language) ? i18n.language : DEFAULT_UI_LOCALE;

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    if (landing.phase !== "idle") return;
    setFailure(null);
    await landing.send(
      () => register(username, password, locale, studies),
      // Django's password validators say precisely what was wrong with a
      // password, and repeating that next to the field is the whole value of
      // having them; the password stays, since that is what they are about.
      (error) => setFailure(describeError(error, { shownFields: FIELDS })),
    );
  };

  return (
    <AuthLayout
      heading={t("auth.registerTitle")}
      refusals={landing.refusals}
      phase={landing.phase}
      footer={
        <>
          {t("auth.haveAccount")}{" "}
          <Link to="/login" className="font-medium text-ink underline">
            {t("auth.logIn")}
          </Link>
        </>
      }
    >
      <form className="flex flex-col gap-room" onSubmit={(event) => void onSubmit(event)}>
        <NewAccountFields
          username={username}
          password={password}
          onUsername={setUsername}
          onPassword={setPassword}
          refusal={refusal}
        />
        <StudiesFields
          programmes={programmes.data}
          value={studies}
          onChange={setStudies}
          failure={failure}
          hint={t("studies.hint")}
        />
        {refusal.alert}
        <AuthButton phase={landing.phase}>{t("auth.register")}</AuthButton>
      </form>
    </AuthLayout>
  );
}
