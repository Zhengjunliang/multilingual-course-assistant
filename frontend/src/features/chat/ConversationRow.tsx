/**
 * One conversation in the sidebar (#192), on two lines (DESIGN.md, rule 1):
 * its title and the time of its last message, then what its last answer drew
 * on, a book and the first course's name with «+N» for the others, a
 * landmark and «Ateneo» for the university's pages, or both, and «Nessuna
 * fonte» when every answer was refused for want of excerpts.
 *
 * The title carries the language its first question was asked in, a course
 * name the language the catalogue names it in, so a screen reader reads each
 * in its own and the Chinese stack follows `lang` (DESIGN.md, "Type"); the
 * interface's own words carry none.
 *
 * Under the pointer or the focus the pin and delete buttons take the time's
 * place, and the row makes room for them on both lines, as ChatGPT's row
 * actions do; on a touch screen, which has no pointer to rest, they are
 * always there and the time is not. A pin on its way is `aria-disabled`
 * rather than disabled, so the focus it holds stays on it (DESIGN.md, "Do's
 * and Don'ts").
 */

import { BookOpen, Landmark, Pin, PinOff, Trash2 } from "lucide-react";
import type { Ref } from "react";
import { useTranslation } from "react-i18next";
import { NavLink } from "react-router-dom";

import type { ConversationSource, ConversationSummary } from "@/api/conversations";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { SIDEBAR_ROW, SIDEBAR_ROW_CURRENT, timeLabel } from "./rows";

interface ConversationRowProps {
  conversation: ConversationSummary;
  /** The title as shown, its fallback included. */
  label: string;
  onNavigate?: () => void;
  /** Whether its pin or unpin is on its way to the server. */
  pinning: boolean;
  onPin: () => void;
  /** `button` is the delete button, where the focus returns to. */
  onDelete: (button: HTMLElement) => void;
  pinRef: Ref<HTMLButtonElement>;
}

export function ConversationRow({
  conversation,
  label,
  onNavigate,
  pinning,
  onPin,
  onDelete,
  pinRef,
}: ConversationRowProps) {
  const { t, i18n } = useTranslation();
  const PinIcon = conversation.pinned ? PinOff : Pin;

  return (
    <li className="group relative">
      <NavLink
        to={`/c/${conversation.id}`}
        onClick={onNavigate}
        className={({ isActive }) =>
          cn(
            SIDEBAR_ROW,
            "grid grid-cols-[minmax(0,1fr)_auto] gap-y-0 py-tight font-medium",
            // Room for the two buttons and the gaps around them, written out
            // whole for each state, since Tailwind finds a class only as written.
            "pointer-coarse:pr-[calc(var(--spacing-control-xs)*2+var(--spacing-hair)*2)] pointer-fine:group-focus-within:pr-[calc(var(--spacing-control-xs)*2+var(--spacing-hair)*2)] pointer-fine:group-hover:pr-[calc(var(--spacing-control-xs)*2+var(--spacing-hair)*2)]",
            isActive && SIDEBAR_ROW_CURRENT,
          )
        }
      >
        <span
          lang={conversation.title ? conversation.title_locale : undefined}
          className="truncate"
        >
          {label}
        </span>
        <time
          dateTime={conversation.last_message_at}
          className="font-normal text-caption text-muted tabular-nums pointer-coarse:invisible pointer-fine:group-focus-within:invisible pointer-fine:group-hover:invisible"
        >
          {timeLabel(conversation.last_message_at, i18n.language)}
        </time>
        <SourceLine source={conversation.last_source} />
      </NavLink>
      <div className="absolute top-1/2 right-hair flex -translate-y-1/2 gap-hair pointer-fine:opacity-0 pointer-fine:group-focus-within:opacity-100 pointer-fine:group-hover:opacity-100">
        <Button
          ref={pinRef}
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t(conversation.pinned ? "sidebar.unpin" : "sidebar.pin", { title: label })}
          aria-disabled={pinning || undefined}
          onClick={() => {
            if (!pinning) onPin();
          }}
        >
          <PinIcon aria-hidden className="size-icon" />
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="icon-sm"
          aria-label={t("sidebar.delete", { title: label })}
          onClick={(event) => onDelete(event.currentTarget)}
        >
          <Trash2 aria-hidden className="size-icon" />
        </Button>
      </div>
    </li>
  );
}

function SourceLine({ source }: { source: ConversationSource | null }) {
  const { t } = useTranslation();
  const line = "col-span-2 flex min-w-0 items-center gap-hair font-normal text-caption text-muted";
  if (source === null) return <span className={line}>{t("sidebar.noSource")}</span>;
  const [first, ...others] = source.courses;
  return (
    <span className={cn(line, "gap-tight")}>
      {first !== undefined && (
        <span className="flex min-w-0 items-center gap-hair">
          <BookOpen aria-hidden className="size-icon shrink-0" />
          <span lang={first.locale ?? undefined} className="truncate">
            {first.name}
          </span>
          {others.length > 0 && (
            <span className="shrink-0 tabular-nums">
              <span aria-hidden>+{others.length}</span>
              <span className="sr-only"> {t("sidebar.moreCourses", { count: others.length })}</span>
            </span>
          )}
        </span>
      )}
      {source.web && (
        <span className="flex shrink-0 items-center gap-hair">
          <Landmark aria-hidden className="size-icon shrink-0" />
          {t("sidebar.campus")}
        </span>
      )}
    </span>
  );
}
