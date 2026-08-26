import { useTranslation } from "react-i18next";
import { Button } from "@/components/ui/button";
import { AskPanel } from "@/features/chat/AskPanel";
import { UI_LOCALES } from "@/i18n";

export default function App() {
  const { t, i18n } = useTranslation();

  return (
    <div className="mx-auto flex min-h-full max-w-5xl flex-col gap-8 px-6 py-10">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="font-semibold text-2xl text-slate-900">{t("app.title")}</h1>
          <p className="text-slate-600 text-sm">{t("app.subtitle")}</p>
        </div>
        {/* A plain switch until the login stage: the account's `locale` is what
            will drive this, and there is no account yet. */}
        <nav className="flex gap-1">
          {UI_LOCALES.map((locale) => (
            <Button
              key={locale}
              type="button"
              size="sm"
              variant={i18n.language === locale ? "default" : "outline"}
              onClick={() => void i18n.changeLanguage(locale)}
            >
              {locale}
            </Button>
          ))}
        </nav>
      </header>
      <main>
        <AskPanel />
      </main>
    </div>
  );
}
