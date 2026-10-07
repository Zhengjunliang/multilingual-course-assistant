import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-tight whitespace-nowrap rounded-control text-body font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-ink shadow-raised hover:bg-accent/90",
        outline: "border border-line bg-surface text-ink shadow-raised hover:bg-mark",
        ghost: "text-muted hover:bg-mark hover:text-ink",
        // The one variant with a hue: it confirms an action that destroys
        // something, and the hue is the one index.css keeps for that and for a
        // failure (docs/decisions.md).
        destructive: "bg-warn-ink text-accent-ink shadow-raised hover:bg-warn-ink/90",
      },
      size: {
        default: "h-control px-gutter py-tight",
        sm: "h-control-sm px-snug text-caption",
        icon: "size-control-icon",
      },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);

export type ButtonProps = ComponentProps<"button"> & VariantProps<typeof buttonVariants>;

export function Button({ className, variant, size, ...props }: ButtonProps) {
  return <button className={cn(buttonVariants({ variant, size }), className)} {...props} />;
}
