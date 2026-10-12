/**
 * A person, when there is no picture of them.
 *
 * `Account` carries no image URL, and adding one would mean touching
 * `apps/accounts/`. So this is a letter in a circle, and `@radix-ui/react-avatar` is not installed: that component
 * exists to sequence an image load against a fallback, and there is no image to
 * load. A dependency whose entire job is the case that cannot happen here.
 *
 * Two tones (#190): `accent`, the tint of a chip in the accent, edged by its
 * hairline, and `neutral` on `--mark`, so a list can tell two kinds of people
 * apart. Three sizes: `sm` inside a line of text or a stack, `md` and `lg` as
 * tall as the control beside them.
 */

import { cn } from "@/lib/utils";

interface AvatarProps {
  /**
   * Shown as the first letters of its first two words, uppercased: "Laura
   * Conti" is LC, the username "demo-student" DS and "junliang" J. Words
   * break at spaces, dots, hyphens and underscores, as usernames are written.
   * An empty name renders no letter.
   */
  name: string;
  size?: "sm" | "md" | "lg";
  tone?: "accent" | "neutral";
  className?: string;
}

const SIZES = {
  sm: "size-avatar-sm text-caption",
  md: "size-control-sm text-caption",
  lg: "size-control text-body",
} as const;

export function Avatar({ name, size = "md", tone = "accent", className }: AvatarProps) {
  // `[...word]` and not `word[0]`: the first *character* of "Émile" is one code
  // point but the first UTF-16 unit of an emoji or a rarer CJK glyph is half of
  // a surrogate pair, which renders as a replacement square.
  const initials = name
    .split(/[\s._-]+/)
    .filter((word) => word !== "")
    .slice(0, 2)
    .map((word) => [...word][0]?.toUpperCase() ?? "")
    .join("");

  return (
    <span
      aria-hidden
      className={cn(
        "flex shrink-0 select-none items-center justify-center rounded-full font-semibold ring-1 ring-inset",
        SIZES[size],
        tone === "accent"
          ? "bg-accent-soft text-accent ring-accent-line"
          : "bg-mark text-ink ring-line",
        className,
      )}
    >
      {initials}
    </span>
  );
}
