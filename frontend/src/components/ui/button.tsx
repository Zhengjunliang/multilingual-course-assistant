import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentProps } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-tight whitespace-nowrap rounded-md text-body font-medium transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        default: "bg-accent text-accent-ink hover:opacity-90",
        outline: "border border-line bg-surface text-ink hover:bg-mark",
        ghost: "text-muted hover:bg-mark hover:text-ink",
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
