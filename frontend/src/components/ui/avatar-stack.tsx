/**
 * A few people at a glance: their avatars overlapping, each cut out of the
 * ground by a ring of the surface, and the rest as "+N".
 *
 * Hidden from assistive technology, like each avatar: the names it stands
 * for are written beside it, as a list of usernames or a count of people.
 */

import { Avatar } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

interface AvatarStackProps {
  names: readonly string[];
  /** How many avatars to draw before the rest become "+N". */
  max?: number;
  className?: string;
}

export function AvatarStack({ names, max = 3, className }: AvatarStackProps) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <span aria-hidden className={cn("flex shrink-0 items-center -space-x-tight", className)}>
      {shown.map((name, index) => (
        // biome-ignore lint/suspicious/noArrayIndexKey: two people may share a display name, and the list never reorders
        <Avatar key={index} name={name} size="sm" className="outline-2 outline-surface" />
      ))}
      {rest > 0 && (
        <span className="flex size-avatar-sm shrink-0 items-center justify-center rounded-full bg-mark font-semibold text-caption text-muted outline-2 outline-surface">
          +{rest}
        </span>
      )}
    </span>
  );
}
