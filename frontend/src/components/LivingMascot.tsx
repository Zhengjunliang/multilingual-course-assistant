/**
 * Fumetto alive, where a screen greets (#173): it blinks, flicks an ear,
 * sways the speech bubble's tip like a tail and breathes; its eyes follow the
 * pointer, or the text being typed, and rest on the question box when nobody
 * moves; it smiles while the pointer is on the send button, hops when a
 * question goes, and falls asleep after ten idle seconds until something moves.
 * On a sign-in form (#183) it shuts its eyes and turns aside while a password
 * is typed, peeks with one eye while the letters are shown, watches the form
 * being sent, frowns at a refusal, glances at the fields a password manager
 * fills, and smiles when it lands on the entry.
 * components/mascotLife.ts decides all of that; this draws it.
 *
 * One `requestAnimationFrame` loop changes the drawing's attributes in place,
 * so React renders the cat once and never per frame. The drawing at first
 * paint is the cat at rest, which is also all it ever shows to a reader whose
 * system asks for reduced motion: the loop does not run at all then. It stops
 * while the tab is hidden, and a device that cannot hover gets no pointer to
 * follow.
 *
 * Nothing on the page stops it. The cat moves by itself for longer than five
 * seconds, which WCAG 2.2.2 answers with a stop control; the entry goes
 * without one by the author's choice, and the system's reduced motion is the
 * only way to still it.
 *
 * What the cat reacts to is marked on the page rather than handed in, and the
 * cat asks each frame, so a control need not know the cat exists and one that
 * goes away leaves no reaction behind: `data-mascot-cheer` on the send button
 * and the sign-in button (a smile while the pointer is on it),
 * `data-mascot-busy` on the sign-in button while it is sent (the eyes on it),
 * and `data-mascot-away` around a password field and its eye
 * (components/PasswordField.tsx). A password manager's fill fires no input
 * event, so index.css starts a one-millisecond `autofill` animation on a
 * filled field, after MUI's InputBase, and its `animationstart` is the sign.
 */

import { useEffect, useId, useLayoutEffect, useRef } from "react";

import { DETAIL_STROKE, HEAD, LIVING, outline, STROKE } from "@/brand/fumetto";
import { useReducedMotion } from "@/lib/useReducedMotion";
import { cn } from "@/lib/utils";
import {
  born,
  frown,
  glance,
  glancing,
  hop,
  type Life,
  live,
  type Pose,
  poke,
  STILL,
  TIMING,
  twitch,
  welcome as welcomed,
} from "./mascotLife";

const NO_HOVER = "(hover: none)";
const LINE = { strokeLinecap: "round", strokeLinejoin: "round" } as const;

const SIDES = ["left", "right"] as const;
const EYE_PARTS = ["blink", "open", "droop", "happy", "shut"] as const;

const parts = [
  "body",
  "outline",
  "look",
  "pupil-left",
  "pupil-right",
  "face",
  "mouth",
  "flat",
  "yawn",
  "whiskers",
  "stars",
  "zs",
  ...SIDES.flatMap((side) => EYE_PARTS.map((part) => `${part}-${side}` as const)),
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
  p.look.setAttribute(
    "transform",
    `translate(${fixed(pose.eyeX * 0.55)} ${fixed(pose.eyeY * 0.45)})`,
  );
  const [left, right] = LIVING.pupils;
  p["pupil-left"].setAttribute("cx", fixed(left.cx + pose.eyeX * 0.6));
  p["pupil-left"].setAttribute("cy", fixed(left.cy + pose.eyeY * 0.6));
  p["pupil-right"].setAttribute("cx", fixed(right.cx + pose.eyeX * 0.6));
  p["pupil-right"].setAttribute("cy", fixed(right.cy + pose.eyeY * 0.6));
  for (const side of SIDES) {
    const eye = pose.eyes[side];
    p[`blink-${side}`].setAttribute(
      "transform",
      `translate(0 39) scale(1 ${fixed(pose.blink, 3)}) translate(0 -39)`,
    );
    show(p[`open-${side}`], eye === "open");
    show(p[`droop-${side}`], eye === "droop");
    show(p[`happy-${side}`], eye === "happy");
    show(p[`shut-${side}`], eye === "shut");
  }
  p.whiskers.setAttribute("transform", `rotate(${degrees(pose.whisker)} 52 42)`);
  show(p.mouth, pose.mouth === "smile");
  show(p.flat, pose.mouth === "flat");
  show(p.yawn, pose.mouth === "yawn");

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

const centre = (element: Element) => {
  const r = element.getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
};

interface LivingMascotProps {
  className?: string;
  /** The id of the field the eyes rest on when nobody moves: the question box. */
  restOn?: string;
  /** Changes each time a question is sent, and the cat hops. */
  hops?: number;
  /** Changes each time a sign-in form is refused, and the cat frowns. */
  refusals?: number;
  /**
   * The cat smiles: on a sign-in form as the server accepts it, on the entry
   * as it lands there from the form. When it appears with it, or it turns on.
   */
  welcome?: boolean;
  /**
   * The intro (features/entry/): the cat arrives drawn in one stroke. Read
   * when the cat appears; never under reduced motion, which skips the intro.
   */
  drawIn?: boolean;
}

export function LivingMascot({
  className,
  restOn,
  hops = 0,
  refusals = 0,
  welcome = false,
  drawIn = false,
}: LivingMascotProps) {
  const svg = useRef<SVGSVGElement>(null);
  const life = useRef<Life | null>(null);
  const reduced = useReducedMotion();
  const sketching = useRef(drawIn);
  const mask = `fumetto-${useId().replace(/[^\w-]/g, "")}`;

  useEffect(() => {
    const element = svg.current;
    if (element === null) return;
    const p = find(element);
    if (reduced) {
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
    /** The fields a password manager has just filled, in the order it filled them. */
    const filled: Element[] = [];
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
      const hidden = active?.closest("[data-mascot-away]") ?? null;
      const sending = document.querySelector("[data-mascot-busy]");
      const step = glancing(cat, now);
      const glancedAt = step === null ? undefined : (filled[step] ?? filled.at(-1));
      let target: { x: number; y: number } | null = null;
      if (glancedAt !== undefined) {
        target = centre(glancedAt);
      } else if (sending !== null) {
        target = centre(sending);
      } else if (field !== null) {
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
        away: hidden !== null,
        peek: hidden?.querySelector("input")?.type === "text",
        busy: sending !== null,
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
    const onTyped = () => twitch(cat);
    const onFilled = (event: AnimationEvent) => {
      if (event.animationName !== "autofill" || !(event.target instanceof Element)) return;
      const now = clock();
      if (glancing(cat, now) === null) {
        filled.length = 0;
        glance(cat, now);
      }
      if (!filled.includes(event.target)) filled.push(event.target);
    };
    const onVisibility = () => (document.visibilityState === "visible" ? start() : stop());

    window.addEventListener("pointermove", onPointer);
    window.addEventListener("pointerdown", onPointer);
    window.addEventListener("keydown", onInput);
    window.addEventListener("wheel", onInput, { passive: true });
    document.addEventListener("input", onTyped, true);
    document.addEventListener("animationstart", onFilled, true);
    document.addEventListener("visibilitychange", onVisibility);
    start();
    return () => {
      stop();
      life.current = null;
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("pointerdown", onPointer);
      window.removeEventListener("keydown", onInput);
      window.removeEventListener("wheel", onInput);
      document.removeEventListener("input", onTyped, true);
      document.removeEventListener("animationstart", onFilled, true);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [reduced, restOn]);

  // Only a change counts: a cat that appears after a question went, as the
  // entry does again for a new conversation, has nothing to hop for.
  const hopsSeen = useRef(hops);
  useEffect(() => {
    if (hops === hopsSeen.current) return;
    hopsSeen.current = hops;
    if (life.current !== null) hop(life.current, performance.now() / 1000);
  }, [hops]);

  // After the cat is born above, so that one appearing with a welcome has a
  // life to smile with.
  useEffect(() => {
    if (welcome && life.current !== null) welcomed(life.current, performance.now() / 1000);
  }, [welcome]);

  // The same for a refusal: a form that opens has been refused by nobody.
  // Before the frame is drawn, as the form stops being sent in the same
  // commit: a frame in between would show the send button's smile.
  const refusalsSeen = useRef(refusals);
  useLayoutEffect(() => {
    if (refusals === refusalsSeen.current) return;
    refusalsSeen.current = refusals;
    if (life.current !== null) frown(life.current, performance.now() / 1000);
  }, [refusals]);

  // The intro ending, by Skip or by itself, ends the drawing in with it.
  useEffect(() => {
    if (drawIn || !sketching.current) return;
    sketching.current = false;
    if (svg.current !== null) sketch(find(svg.current), null);
  }, [drawIn]);

  const [left, right] = LIVING.pupils;
  return (
    <div className={cn("aspect-mascot", className)}>
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
              {SIDES.map((side, i) => (
                <g key={side}>
                  <g data-part={`blink-${side}`}>
                    <g
                      mask={`url(#${mask})`}
                      fill="currentColor"
                      strokeWidth={1}
                      strokeLinejoin="round"
                    >
                      <path data-part={`open-${side}`} d={LIVING.eyes[i]} />
                      <path data-part={`droop-${side}`} d={LIVING.droopingEyes[i]} display="none" />
                    </g>
                  </g>
                  <path
                    data-part={`happy-${side}`}
                    d={LIVING.happyEyes[i]}
                    strokeWidth={DETAIL_STROKE}
                    display="none"
                  />
                  <path
                    data-part={`shut-${side}`}
                    d={LIVING.sleepingEyes[i]}
                    strokeWidth={DETAIL_STROKE}
                    display="none"
                  />
                </g>
              ))}
            </g>
            <path data-part="mouth" d={LIVING.mouth} strokeWidth={DETAIL_STROKE} />
            <path
              data-part="flat"
              d={LIVING.flatMouth}
              strokeWidth={DETAIL_STROKE}
              display="none"
            />
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
    </div>
  );
}
