/**
 * A person, when there is no picture of them.
 *
 * `Account` carries an id, a username and a locale and nothing else — no image
 * URL, and adding one would mean touching `apps/accounts/`. So this is a letter
 * in a circle, and `@radix-ui/react-avatar` is not installed: that component
 * exists to sequence an image load against a fallback, and there is no image to
 * load. A dependency whose entire job is the case that cannot happen here.
 *
 * `--mark` rather than the accent. On an achromatic palette the accent is the
 * strongest black or white available, and it is spent on what a reader is about
 * to do; an avatar is a label for who they already are.
 */

import { cn } from "@/lib/utils";

export interface AvatarProps {
  /** Shown as its first letter, uppercased. An empty name renders no letter. */
  name: string;
  className?: string;
}

export function Avatar({ name, className }: AvatarProps) {
  // `[...name]` and not `name[0]`: the first *character* of "Émile" is one code
  // point but the first UTF-16 unit of an emoji or a rarer CJK glyph is half of
  // a surrogate pair, which renders as a replacement square.
  const initial = [...name.trim()][0]?.toUpperCase() ?? "";

  return (
    <span
      aria-hidden
      className={cn(
        "flex size-control-icon shrink-0 select-none items-center justify-center rounded-full bg-mark font-medium text-caption text-ink",
        className,
      )}
    >
      {initial}
    </span>
  );
}
