/**
 * The courses a signed-in reader's questions search, in the question box's
 * foot (#36): a button saying the current editions and how many the
 * conversation adds, which opens the course list (scope.ts).
 *
 * Each course is a section of the menu under its name, each of its editions
 * a box to tick. An edition a question searches in any case, a course's
 * current one or a teacher's not started yet, is ticked and cannot be
 * unticked; the others, a past year or, for staff, one not started yet, are
 * the conversation's to add, as many as one question carries
 * (`MAX_ADDED_EDITIONS`). The choice goes with the next question, as
 * ChatGPT's and Open WebUI's composers carry the tools chosen in theirs
 * (outside the repository).
 *
 * An account with neither a programme nor a role searches no course, and is
 * pointed at the account page to say what it studies. A programme with no
 * course started yet shows nothing: there is nothing to search or to add.
 */

import { Library } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { MAX_ADDED_EDITIONS } from "@/api/client";
import type { ScopeCourse } from "@/api/scope";
import { buttonVariants } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";
import { shownAdded, toggled } from "./scope";

interface ScopeButtonProps {
  /** `null` until the list arrives, and when it could not be read. */
  courses: readonly ScopeCourse[] | null;
  /** The account says what it studies (`Session.programme`). */
  declared: boolean;
  /** What the conversation adds, as the page holds it (`useAsk`). */
  added: readonly number[];
  onChoose: (added: number[]) => void;
}

export function ScopeButton({ courses, declared, added, onChoose }: ScopeButtonProps) {
  const { t } = useTranslation();
  if (courses === null) return null;
  if (courses.length === 0) {
    return declared ? null : (
      <Link to="/account" className="font-medium text-ink underline">
        {t("scope.declare")}
      </Link>
    );
  }

  const shown = shownAdded(courses, added);
  // As many as one question carries: the rest wait until one is taken out.
  const full = shown.length >= MAX_ADDED_EDITIONS;
  return (
    <DropdownMenu
      trigger={
        <>
          <Library aria-hidden className="size-icon" />
          {shown.length === 0 ? t("scope.current") : t("scope.added", { count: shown.length })}
        </>
      }
      triggerClassName={cn(buttonVariants({ variant: "ghost", size: "sm" }), "rounded-full")}
      side="top"
      align="start"
      head={<span className="block max-w-80 text-caption text-muted">{t("scope.head")}</span>}
      sections={courses.map((course) => ({
        key: course.code,
        label: course.name,
        labelLang: course.locale,
        items: course.editions.map((edition) => ({
          key: String(edition.id),
          label: edition.academic_year,
          detail: t(`scope.state.${edition.state}`),
          checked: edition.default || shown.includes(edition.id),
          disabled: edition.default || (full && !shown.includes(edition.id)),
          onCheckedChange: () => onChoose(toggled(courses, added, edition.id)),
        })),
      }))}
    />
  );
}
