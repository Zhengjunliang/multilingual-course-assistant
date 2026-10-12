/**
 * The room behind the entry screens (#183): the sign-in and registration
 * forms and the entry at `/`, drawn in the cat's line and blue. A bookshelf
 * with a plant and a paper plane on one side; a window with clouds and a desk
 * with a lamp, a mug and books on the other. Chosen by the author on a
 * prototype, after the Firewatch website's layered scene and unseen.co.
 *
 * Two wings, each anchored to a lower corner, rather than one picture across
 * the screen: the middle is where the card or the question box stands, and
 * no line may run under them or under any text, so each wing is at most half
 * of what the content in the middle (`clear`) leaves free, and shrinks with
 * it. On a phone the two wings stand side by side in a strip under the form
 * instead, in the page's flow, where nothing can sit on them.
 *
 * It draws itself in once per page load, its lines one after another, and
 * after that it moves only with the pointer: three depths, a few pixels each,
 * at most 10, after the Firewatch site's parallax. It never moves by itself,
 * so WCAG 2.2.2 asks it for no pause control. Under reduced motion it is drawn
 * whole from the first frame and never moves; a device that cannot hover gets
 * no parallax. While a visitor's first-visit intro plays, the drawing in
 * waits for it (index.css). The lines keep their width at any size
 * (`non-scaling-stroke`).
 *
 * Each line is drawn in by a dash as long as the line is on screen, measured
 * before the first frame: `pathLength` cannot stand in for it, since with
 * `non-scaling-stroke` Chrome lays the dash out in screen pixels and a wing
 * drawn larger than its plan would keep only part of each line. The dash goes
 * once the last line is in, so a wing resized later stays whole.
 *
 * It leaves with the entry: `leaving` fades it as the entry recedes into the
 * conversation, which keeps the grain alone.
 */

import { type CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";

import { useReducedMotion } from "@/lib/useReducedMotion";
import { cn } from "@/lib/utils";

interface Line {
  d: string;
  /** Drawn at the thinner width: a detail, not an outline. */
  thin?: boolean;
}

/** Further layers move less: 3, 6 and 10 at most, in screen pixels. */
interface Layer {
  depth: 3 | 6 | 10;
  lines: readonly Line[];
}

interface Wing {
  side: "left" | "right";
  /** The wing's part of the room's 1200 by 800 plan. */
  viewBox: readonly [number, number, number, number];
  layers: readonly Layer[];
}

const WINGS: readonly Wing[] = [
  {
    side: "left",
    viewBox: [0, 120, 360, 660],
    layers: [
      {
        depth: 6,
        lines: [
          { d: "M80 300H320M80 300V760M320 300V760M80 450H320M80 600H320" },
          {
            d: "M96 450V332H118V450M120 450V346H138V450M140 450V324H166V450M168 450V354H188V450",
            thin: true,
          },
          {
            d: "M194 450L216 352L234 356L212 450M240 450V340H264V450M266 450V358H284V450",
            thin: true,
          },
          { d: "M142 360H164M142 372H164M242 372H262", thin: true },
          { d: "M96 600V480H120V600M122 600V490H142V600M144 600V472H174V600", thin: true },
          { d: "M180 600V584H248V600M184 584V570H242V584", thin: true },
          { d: "M258 552a24 24 0 1 0 48 0a24 24 0 1 0-48 0", thin: true },
          { d: "M272 552a10 24 0 1 0 20 0a10 24 0 1 0-20 0", thin: true },
          { d: "M258 552H306M282 576V600M266 600H298", thin: true },
          {
            d: "M100 760V664H190V760M112 692H178M200 760V632H222V760M224 760V644H250V760M252 760V622H272V760M276 760V638H304V760",
            thin: true,
          },
          { d: "M152 300L158 268H202L208 300" },
          { d: "M180 268C176 240 160 226 138 222C148 242 160 256 180 268Z", thin: true },
          { d: "M180 268C184 238 200 222 222 218C214 240 200 256 180 268Z", thin: true },
          { d: "M180 268C180 248 182 232 188 214", thin: true },
        ],
      },
      {
        depth: 10,
        lines: [
          { d: "M0 760H360" },
          { d: "M262 176L342 146L304 196L296 168ZM296 168L342 146", thin: true },
        ],
      },
    ],
  },
  {
    side: "right",
    viewBox: [800, 120, 400, 660],
    layers: [
      {
        depth: 3,
        lines: [
          { d: "M914 238c0-11 9-17 18-16c3-10 11-15 21-15c11 0 19 7 21 17c8 0 14 6 14 14Z" },
          {
            d: "M1022 344c0-8 6-12 13-11c2-7 8-11 15-11c8 0 14 5 15 12c6 0 10 4 10 10Z",
            thin: true,
          },
          { d: "M1052 200c0-6 5-9 10-9c2-5 6-8 11-8c6 0 10 4 11 9c5 0 8 3 8 8Z", thin: true },
        ],
      },
      {
        depth: 6,
        lines: [
          { d: "M890 158a8 8 0 0 1 8-8h204a8 8 0 0 1 8 8v244a8 8 0 0 1-8 8H898a8 8 0 0 1-8-8Z" },
          { d: "M1000 150V410M890 280H1110", thin: true },
          { d: "M874 410H1126" },
          { d: "M882 420H1118", thin: true },
        ],
      },
      {
        depth: 10,
        lines: [
          { d: "M800 760H1200" },
          { d: "M826 640H1200" },
          { d: "M826 652H1200M858 652V760M1172 652V760", thin: true },
          { d: "M1060 640C1060 630 1070 624 1084 624C1098 624 1108 630 1108 640" },
          { d: "M1084 624L1048 548L1096 488" },
          { d: "M1096 488L1134 470L1152 512L1110 522Z" },
          { d: "M900 600H940V630C940 636 936 640 930 640H910C904 640 900 636 900 630Z" },
          { d: "M940 610C953 610 953 628 940 628", thin: true },
          { d: "M912 590C906 580 918 572 912 562M926 590C920 580 932 572 926 562", thin: true },
          { d: "M960 640V622H1040V640M966 622V606H1032V622M958 606V590H1030V606", thin: true },
        ],
      },
    ],
  },
];

/** Whether this page load has drawn the room in already: it draws in once. */
let drawn = false;

const clamp = (x: number) => Math.max(-0.5, Math.min(0.5, x));

interface RoomProps {
  /** The width the content in the middle needs kept clear, as a CSS length. */
  clear: string;
  /** The entry is receding into the conversation: the room fades with it. */
  leaving?: boolean;
}

export function Room({ clear, leaving = false }: RoomProps) {
  const reduced = useReducedMotion();
  const [drawing, setDrawing] = useState(() => !drawn);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    drawn = true;
  }, []);

  // Reduced motion turned on midway cancels the drawing rather than ending
  // it, and the room stays whole from then on.
  useEffect(() => {
    if (reduced) setDrawing(false);
  }, [reduced]);

  // Each line's length on screen, for its dash, before the first frame.
  useLayoutEffect(() => {
    const element = root.current;
    if (element === null || !drawing) return;
    for (const svg of element.querySelectorAll("svg")) {
      const scale = svg.getScreenCTM?.()?.a || 1;
      for (const path of svg.querySelectorAll("path")) {
        const length = path.getTotalLength?.() ?? 0;
        path.style.setProperty("--len", `${Math.ceil(length * scale) + 1}px`);
      }
    }
  }, [drawing]);

  // The pointer, read once a frame: each layer slides against it by its
  // depth, in screen pixels, whatever size the wing is drawn at; 4 parts
  // across to 3 up and down, so a corner moves it by its depth and no more.
  useEffect(() => {
    const element = root.current;
    if (element === null || reduced || window.matchMedia("(hover: none)").matches) return;
    let frame = 0;
    let last: PointerEvent | null = null;
    const move = () => {
      frame = 0;
      if (last === null) return;
      const x = clamp(last.clientX / window.innerWidth - 0.5);
      const y = clamp(last.clientY / window.innerHeight - 0.5);
      for (const svg of element.querySelectorAll("svg")) {
        const scale = svg.getScreenCTM()?.a || 1;
        for (const layer of svg.querySelectorAll<SVGGElement>("g[data-depth]")) {
          const depth = Number(layer.dataset.depth);
          layer.style.transform = `translate(${((-x * 1.6 * depth) / scale).toFixed(2)}px, ${((-y * 1.2 * depth) / scale).toFixed(2)}px)`;
        }
      }
    };
    const onPointer = (event: PointerEvent) => {
      last = event;
      if (frame === 0) frame = requestAnimationFrame(move);
    };
    window.addEventListener("pointermove", onPointer);
    return () => {
      window.removeEventListener("pointermove", onPointer);
      cancelAnimationFrame(frame);
    };
  }, [reduced]);

  let order = 0;
  return (
    <div
      ref={root}
      aria-hidden
      data-room
      style={{ "--clear": clear } as CSSProperties}
      className={cn(
        "pointer-events-none text-accent transition-opacity duration-reveal max-md:relative max-md:order-last max-md:h-48 max-md:w-full max-md:shrink-0 md:absolute md:inset-0",
        leaving && "opacity-0",
        drawing && !reduced && "room-draw",
      )}
      onAnimationEnd={(event) => {
        const lines = event.currentTarget.querySelectorAll("path");
        if (event.animationName === "room-line" && event.target === lines[lines.length - 1]) {
          setDrawing(false);
        }
      }}
    >
      {WINGS.map(({ side, viewBox, layers }) => (
        <svg
          key={side}
          viewBox={viewBox.join(" ")}
          preserveAspectRatio={side === "left" ? "xMinYMax meet" : "xMaxYMax meet"}
          aria-hidden
          focusable="false"
          className={cn(
            "room-lines absolute bottom-0 h-full overflow-visible max-md:max-w-1/2 md:max-w-[calc((100%-var(--clear))/2)]",
            side === "left" ? "left-0" : "right-0",
          )}
          style={{ aspectRatio: `${viewBox[2]} / ${viewBox[3]}` }}
        >
          {layers.map(({ depth, lines }) => (
            <g
              key={depth}
              data-depth={depth}
              className="transition-transform duration-reveal ease-out motion-reduce:transition-none"
            >
              {lines.map(({ d, thin }) => (
                <path
                  key={d}
                  d={d}
                  vectorEffect="non-scaling-stroke"
                  strokeWidth={thin === true ? 1.5 : 2}
                  style={{ "--i": order++ } as CSSProperties}
                />
              ))}
            </g>
          ))}
        </svg>
      ))}
    </div>
  );
}
