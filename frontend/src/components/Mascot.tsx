/**
 * Fumetto on screen: a pose in the line, and the mark on its tile.
 *
 * Drawn from src/brand/fumetto.ts, the same shapes the brand files are written
 * from, in theme colours rather than hex: the line takes `currentColor`, the
 * accent by default, and the mark the accent and its ink, so both follow the
 * theme with no second drawing.
 *
 * Always `aria-hidden`. Every place the cat stands has words beside it saying
 * the same thing — the app's name, a greeting, "searching", the error, "not
 * found" — and an image accompanied by text that says what it says is
 * decorative (WAI's images tutorial); naming it would make a screen reader say
 * everything twice.
 *
 * The pupils are cut out of the eyes by a mask, so the ground shows through
 * whatever it is. Its id comes from `useId`, stripped to what a `url(#…)`
 * reference takes, because two cats on one page must not share a mask.
 */

import { type ComponentProps, useId } from "react";

import {
  DETAIL_STROKE,
  type Drawing,
  HEAD,
  ICON,
  MARK_PUPILS,
  POSES,
  type Pose,
  placement,
  STROKE,
} from "@/brand/fumetto";
import { cn } from "@/lib/utils";

type SvgProps = Omit<ComponentProps<"svg">, "children" | "viewBox">;

const LINE = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

export function Mascot({ pose, className, ...props }: SvgProps & { pose: Pose }) {
  const drawing: Drawing = POSES[pose];
  const mask = `fumetto-${useId().replace(/[^\w-]/g, "")}`;

  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden
      focusable="false"
      data-pose={pose}
      className={cn(
        "shrink-0 text-accent",
        // Work under way: the one motion the cat makes until #135 gives it
        // more, the whole drawing rather than its thought dots, which are a
        // pixel wide beside an answer; and none for a reader who asked for none.
        pose === "thinking" && "animate-pulse motion-reduce:animate-none",
        className,
      )}
      {...props}
    >
      <path d={HEAD} fill="none" stroke="currentColor" strokeWidth={STROKE} {...LINE} />
      {drawing.eyes.length > 0 && (
        <>
          <mask id={mask}>
            <rect width="64" height="64" fill="white" />
            {drawing.pupils.map(({ cx, cy, r }) => (
              <circle key={`${cx} ${cy}`} cx={cx} cy={cy} r={r} fill="black" />
            ))}
          </mask>
          <g mask={`url(#${mask})`} fill="currentColor" stroke="currentColor" strokeWidth={1}>
            {drawing.eyes.map((d) => (
              <path key={d} d={d} strokeLinejoin="round" />
            ))}
          </g>
        </>
      )}
      <g fill="none" stroke="currentColor" strokeWidth={DETAIL_STROKE} {...LINE}>
        {drawing.strokes.map((d) => (
          <path key={d} d={d} />
        ))}
      </g>
      <g fill="currentColor">
        {drawing.fills.map((d) => (
          <path key={d} d={d} />
        ))}
        {drawing.dots.map(({ cx, cy, r }) => (
          <circle key={`${cx} ${cy}`} cx={cx} cy={cy} r={r} />
        ))}
      </g>
    </svg>
  );
}

/** The mark, the head filled in on its tile: the favicon's drawing, for the app's name. */
export function MascotMark({ className, ...props }: SvgProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      aria-hidden
      focusable="false"
      className={cn("shrink-0", className)}
      {...props}
    >
      <rect width="64" height="64" rx={ICON.radius} className="fill-accent" />
      <g transform={placement(ICON.scale)}>
        <path d={HEAD} className="fill-accent-ink" />
        {POSES.avatar.eyes.map((d) => (
          <path
            key={d}
            d={d}
            strokeWidth={1.6}
            strokeLinejoin="round"
            className="fill-accent stroke-accent"
          />
        ))}
        {MARK_PUPILS.map(({ cx, cy, r }) => (
          <circle key={`${cx} ${cy}`} cx={cx} cy={cy} r={r} className="fill-accent-ink" />
        ))}
      </g>
    </svg>
  );
}
