/**
 * Fumetto alive, where a screen greets (#173): it blinks, flicks an ear,
 * sways the speech bubble's tip like a tail and breathes; its eyes follow the
 * pointer, or the text being typed, and rest on the question box when nobody
 * moves; it smiles while the pointer is on the send button, hops when a
 * question goes, and falls asleep after ten idle seconds until something moves.
 * components/mascotLife.ts decides all of that; this draws it.
 *
 * One `requestAnimationFrame` loop changes the drawing's attributes in place,
 * so React renders the cat once and never per frame. The drawing at first
 * paint is the cat at rest, which is also all it ever shows to a reader whose
 * system asks for reduced motion, and what it shows while paused: the loop
 * does not run at all then. It stops while the tab is hidden, and a device
 * that cannot hover gets no pointer to follow.
 *
 * The cat moves by itself for longer than five seconds, so WCAG 2.2.2 asks for
 * a way to stop it: the button just outside its lower right corner, clear of
 * the drawing. A toggle (`aria-pressed`) whose name stays the same, as the
 * WAI-ARIA toggle button does; the choice is remembered in this browser, like
 * the sidebar's.
 *
 * The send button is marked `data-mascot-cheer` (features/chat/Composer.tsx)
 * rather than handed in, and the cat asks each frame whether the pointer is on
 * it, so the composer need not know the cat exists and a button that goes away
 * under the pointer leaves no smile behind.
 */

import { Pause, Play } from "lucide-react";
import { useEffect, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import { DETAIL_STROKE, HEAD, LIVING, outline, STROKE } from "@/brand/fumetto";
import { Button } from "@/components/ui/button";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { cn } from "@/lib/utils";
import { born, hop, type Life, live, type Pose, poke, STILL, TIMING } from "./mascotLife";

const STORAGE_KEY = "mca.mascot";
const NO_HOVER = "(hover: none)";
const LINE = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

function storedPaused(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) === "paused";
  } catch {
    return false;
  }
}

const parts = [
  "body",
  "outline",
  "look",
  "blink",
  "open",
  "happy",
  "asleep",
  "pupil-left",
  "pupil-right",
  "face",
  "mouth",
  "yawn",
  "whiskers",
  "stars",
  "zs",
] as const;
type Parts = Record<(typeof parts)[number], SVGElement>;

function find(svg: SVGSVGElement): Parts {
  return Object.fromEntries(
    parts.map((part) => [part, svg.querySelector(`[data-part="${part}"]`) as SVGElement]),
  ) as Parts;
}

const fixed = (value: number, digits = 2) => value.toFixed(digits);
const degrees = (radians: number) => fixed((radians * 180) / Math.PI);

/**
 * SVG's own `display`, not `hidden`: the browser's rule that hides `[hidden]`
 * is written for HTML elements.
 */
const show = (element: SVGElement, shown: boolean) =>
  shown ? element.removeAttribute("display") : element.setAttribute("display", "none");

/** Draws `pose`; `now` twinkles the stars, `null` leaves them still. */
function draw(p: Parts, pose: Pose, now: number | null): void {
  p.outline.setAttribute("d", outline(pose.turns));
  p.body.setAttribute(
    "transform",
    `translate(0 ${fixed(pose.hop)}) rotate(${degrees(pose.tilt)} 32 50) ` +
      `translate(32 56) scale(${fixed(1 + pose.breath / 2, 4)} ${fixed(1 + pose.breath, 4)}) translate(-32 -56)`,
  );
  p.blink.setAttribute(
    "transform",
    `translate(0 39) scale(1 ${fixed(pose.blink, 3)}) translate(0 -39)`,
  );
  p.look.setAttribute(
    "transform",
    `translate(${fixed(pose.eyeX * 0.55)} ${fixed(pose.eyeY * 0.45)})`,
  );
  const [left, right] = LIVING.pupils;
  p["pupil-left"].setAttribute("cx", fixed(left.cx + pose.eyeX * 0.6));
  p["pupil-left"].setAttribute("cy", fixed(left.cy + pose.eyeY * 0.6));
  p["pupil-right"].setAttribute("cx", fixed(right.cx + pose.eyeX * 0.6));
  p["pupil-right"].setAttribute("cy", fixed(right.cy + pose.eyeY * 0.6));
  p.whiskers.setAttribute("transform", `rotate(${degrees(pose.whisker)} 52 42)`);
  show(p.open, pose.eyes === "open");
  show(p.happy, pose.eyes === "happy");
  show(p.asleep, pose.eyes === "asleep");
  show(p.mouth, !pose.yawning);
  show(p.yawn, pose.yawning);

  // The stars twinkle in turn, from a third of their strength to all of it.
  [...p.stars.children].forEach((star, i) => {
    const glow = now === null ? 1 : 0.5 - 0.5 * Math.cos((Math.PI * (now - i * 0.9)) / 2.4);
    const dim = pose.zs.length > 0 ? 0.2 : 1;
    star.setAttribute("opacity", fixed(dim * (0.35 + 0.65 * glow), 3));
    (star as SVGElement).style.transform = `scale(${fixed(0.8 + 0.2 * glow, 3)})`;
  });

  show(p.zs, pose.zs.length > 0);
  pose.zs.forEach((climb, i) => {
    const z = p.zs.children[i];
    z?.setAttribute(
      "transform",
      `translate(${fixed(52 + climb * 9 + i)} ${fixed(4 - climb * 16)}) scale(${fixed(0.5 + climb * 0.6, 3)})`,
    );
    z?.setAttribute("opacity", fixed(Math.sin(climb * Math.PI), 3));
  });
}

/** The intro's first moments, in seconds: the outline drawn, then the face. */
const SKETCH = { line: 1.1, faceFrom: 0.95, face: 0.3 } as const;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const easeInOut = (x: number) => (x < 0.5 ? 4 * x ** 3 : 1 - (-2 * x + 2) ** 3 / 2);

/**
 * The outline drawn in one stroke, `since` seconds into it, then the face and
 * the stars fading in; `null` is the cat whole.
 */
function sketch(p: Parts, since: number | null): void {
  const line = p.outline.style;
  if (since === null) {
    line.strokeDasharray = "";
    line.strokeDashoffset = "";
    p.face.style.opacity = "";
    p.stars.style.opacity = "";
    return;
  }
  line.strokeDasharray = "1 1";
  line.strokeDashoffset = fixed(1 - easeInOut(clamp01(since / SKETCH.line)), 4);
  const face = fixed(clamp01((since - SKETCH.faceFrom) / SKETCH.face), 3);
  p.face.style.opacity = face;
  p.stars.style.opacity = face;
}

interface LivingMascotProps {
  className?: string;
  /** The id of the field the eyes rest on when nobody moves: the question box. */
  restOn?: string;
  /** Changes each time a question is sent, and the cat hops. */
  hops?: number;
  /**
   * The intro (features/entry/): the cat arrives drawn in one stroke. Read
   * when the cat appears; never under reduced motion, which skips the intro.
   */
  drawIn?: boolean;
}

export function LivingMascot({ className, restOn, hops = 0, drawIn = false }: LivingMascotProps) {
  const { t } = useTranslation();
  const svg = useRef<SVGSVGElement>(null);
  const life = useRef<Life | null>(null);
  const [paused, setPaused] = useState(storedPaused);
  const reduced = useReducedMotion();
  const sketching = useRef(drawIn);
  const mask = `fumetto-${useId().replace(/[^\w-]/g, "")}`;

  useEffect(() => {
    const element = svg.current;
    if (element === null) return;
    const p = find(element);
    if (reduced || paused) {
      sketching.current = false;
      sketch(p, null);
      draw(p, STILL, null);
      return;
    }

    const clock = () => performance.now() / 1000;
    const cat = born(clock(), Math.random);
    life.current = cat;
    const noHover = window.matchMedia(NO_HOVER);
    const pointer = { x: 0, y: 0, at: Number.NEGATIVE_INFINITY };
    let frame = 0;
    let last = 0;
    let sketchFrom: number | null = null;

    // Read where everything is before anything is written, so the frame
    // costs no layout of its own.
    const senses = (now: number) => {
      const box = element.getBoundingClientRect();
      const face = { x: box.left + box.width / 2, y: box.top + box.height * 0.66 };
      const active = document.activeElement;
      const field =
        active instanceof HTMLInputElement || active instanceof HTMLTextAreaElement ? active : null;
      let target: { x: number; y: number } | null = null;
      if (field !== null) {
        const r = field.getBoundingClientRect();
        const caret = field.selectionStart ?? field.value.length;
        target = { x: r.left + Math.min(r.width - 10, 12 + caret * 8), y: r.top + r.height / 2 };
      } else if (!noHover.matches && now - pointer.at < TIMING.restGaze) {
        target = pointer;
      } else if (restOn !== undefined) {
        const r = document.getElementById(restOn)?.getBoundingClientRect();
        if (r !== undefined) target = { x: r.left + 40, y: r.top + r.height / 2 };
      }
      return {
        gaze: target === null ? null : { x: target.x - face.x, y: target.y - face.y },
        typing: field !== null,
        cheer: document.querySelector("[data-mascot-cheer]:hover") !== null,
      };
    };

    // The frame's timestamp and `performance.now()` share one clock.
    const render = (ms: number) => {
      const now = ms / 1000;
      const dt = last === 0 ? 0 : Math.min(0.05, now - last);
      last = now;
      if (sketching.current) {
        sketchFrom ??= now;
        const since = now - sketchFrom;
        const done = since > SKETCH.faceFrom + SKETCH.face;
        sketch(p, done ? null : since);
        if (done) sketching.current = false;
      }
      draw(p, live(cat, { now, dt, random: Math.random, ...senses(now) }), now);
      frame = requestAnimationFrame(render);
    };
    const start = () => {
      if (frame === 0 && document.visibilityState === "visible") {
        last = 0;
        frame = requestAnimationFrame(render);
      }
    };
    const stop = () => {
      cancelAnimationFrame(frame);
      frame = 0;
    };

    const onPointer = (event: PointerEvent) => {
      pointer.x = event.clientX;
      pointer.y = event.clientY;
      pointer.at = clock();
      poke(cat, pointer.at);
    };
    const onInput = () => poke(cat, clock());
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());

    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onInput);
    window.addEventListener("wheel", onInput, { passive: true });
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      life.current = null;
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("wheel", onInput);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced, paused, restOn]);

  useEffect(() => {
    if (hops > 0 && life.current !== null) hop(life.current, performance.now() / 1000);
  }, [hops]);

  const togglePaused = () => {
    const next = !paused;
    setPaused(next);
    try {
      localStorage.setItem(STORAGE_KEY, next ? "paused" : "playing");
    } catch {
      // The choice still holds on this page; it just will not outlive it.
    }
  };

  const [left, right] = LIVING.pupils;
  return (
    <div className={cn("relative aspect-mascot", className)}>
      <svg
        ref={svg}
        viewBox="-6 -18 76 86"
        aria-hidden
        focusable="false"
        data-living-mascot
        className="size-full overflow-visible text-accent"
      >
        <defs>
          <mask id={mask} maskUnits="userSpaceOnUse" x="0" y="0" width="64" height="64">
            <rect width="64" height="64" fill="white" />
            <circle data-part="pupil-left" cx={left.cx} cy={left.cy} r={left.r} fill="black" />
            <circle data-part="pupil-right" cx={right.cx} cy={right.cy} r={right.r} fill="black" />
          </mask>
        </defs>
        <g data-part="body" fill="none" stroke="currentColor" {...LINE}>
          <path
            data-part="outline"
            d={HEAD}
            strokeWidth={STROKE}
            pathLength={1}
            style={drawIn ? { strokeDasharray: "1 1", strokeDashoffset: 1 } : undefined}
          />
          <g data-part="face" style={drawIn ? { opacity: 0 } : undefined}>
            <g data-part="look">
              <g data-part="blink">
                <g
                  data-part="open"
                  mask={`url(#${mask})`}
                  fill="currentColor"
                  strokeWidth={1}
                  strokeLinejoin="round"
                >
                  {LIVING.eyes.map((d) => (
                    <path key={d} d={d} />
                  ))}
                </g>
              </g>
              <g data-part="happy" strokeWidth={DETAIL_STROKE} display="none">
                {LIVING.happyEyes.map((d) => (
                  <path key={d} d={d} />
                ))}
              </g>
              <g data-part="asleep" strokeWidth={DETAIL_STROKE} display="none">
                {LIVING.sleepingEyes.map((d) => (
                  <path key={d} d={d} />
                ))}
              </g>
            </g>
            <path data-part="mouth" d={LIVING.mouth} strokeWidth={DETAIL_STROKE} />
            <path data-part="yawn" d={LIVING.yawn} strokeWidth={DETAIL_STROKE} display="none" />
            <path data-part="whiskers" d={LIVING.whiskers} strokeWidth={DETAIL_STROKE} />
          </g>
          <g
            data-part="stars"
            fill="currentColor"
            stroke="none"
            style={drawIn ? { opacity: 0 } : undefined}
          >
            {LIVING.stars.map((d) => (
              <path key={d} d={d} style={{ transformBox: "fill-box", transformOrigin: "center" }} />
            ))}
          </g>
        </g>
        <g
          data-part="zs"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          {...LINE}
          display="none"
        >
          {[0, 1, 2].map((i) => (
            <path key={i} d={LIVING.z} />
          ))}
        </g>
      </svg>
      {!reduced && (
        <Button
          type="button"
          variant="ghost"
          size="icon"
          aria-pressed={paused}
          aria-label={t("mascot.pause")}
          onClick={togglePaused}
          className="absolute bottom-0 left-full text-muted"
        >
          {paused ? (
            <Play aria-hidden className="size-icon" />
          ) : (
            <Pause aria-hidden className="size-icon" />
          )}
        </Button>
      )}
    </div>
  );
}
