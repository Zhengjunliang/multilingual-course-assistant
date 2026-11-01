/**
 * The system page's diagram (#236): five nodes, the browser, the site, Redis,
 * the Celery workers and the models and data, with the questions and the
 * uploads under way drawn as dots where they are (feed.ts).
 *
 * Five and no more, for a first look: working memory holds about four chunks
 * (Cowan 2001), and RabbitMQ's tutorials draw three elements to a figure
 * (outside the repository). Redis is drawn as its three roles here: the
 * queues the workers take from, the places under the global cap, a cell
 * each (`QA_MAX_IN_FLIGHT`), and the answers' streams. A worker is a card,
 * one per worker online, with its queues and its pool.
 *
 * A dot arrives from the browser and slides from node to node as its entries
 * come; a refused one bounces off the full places back to its browser, where
 * it counts down to its page's retry, and a finished one rests there a moment
 * and goes. Under reduced motion it jumps. The way back to the browser is in
 * the accent while an answer is being written. Nothing loops, so nothing
 * needs a pause control (WCAG 2.2.2).
 *
 * Hand-drawn SVG on the design's tokens, with no graph library: five fixed
 * nodes need no layout. A dot is the pointer's shortcut to a task's steps;
 * the list below selects the same tasks from the keyboard (RecentTasks.tsx),
 * so to assistive technology the diagram is one image, named by its places.
 */

import { type CSSProperties, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { Worker } from "@/api/system";
import { cn } from "@/lib/utils";
import { type Feed, type Place, placeAt, retryIn, shownWorkers, type Task } from "./feed";

type Point = readonly [number, number];

/** Where the dots gather at each node but the queues and the workers, which lay them out themselves. */
const ANCHOR: Record<"browser" | "seats" | "llm" | "qdrant", Point> = {
  browser: [76, 196],
  seats: [481, 204],
  llm: [926, 110],
  qdrant: [926, 198],
};

/** How far from its node's anchor each of four dots stands, the first in the middle. */
const SPREAD = [0, 16, -16, 32] as const;

/** The edges, by the nodes they join; `back` is the answer's way to the browser. */
const EDGES = [
  { d: "M136 180 L176 180", back: true },
  { d: "M316 168 C 342 150, 348 104, 370 104", back: false },
  { d: "M316 182 C 340 184, 350 192, 370 192", back: false },
  { d: "M592 104 C 616 104, 624 130, 646 150", back: false },
  { d: "M824 150 C 840 120, 846 92, 864 92", back: false },
  { d: "M824 180 L864 180", back: false },
  { d: "M824 210 C 840 240, 846 268, 864 268", back: false },
  { d: "M646 230 C 624 270, 612 282, 592 282", back: true },
  { d: "M370 282 C 344 282, 336 232, 316 196", back: true },
] as const;

/** How long a dot first drawn after the page opened takes to be drawn arriving. */
const ARRIVING_MS = 1500;

const BOX = "fill-surface stroke-line";
const PART = "fill-tint stroke-hairline";
const TITLE = "fill-ink font-semibold text-body";
const CAPTION = "fill-muted text-caption";

/** The page's clock, read every `every` ms: what a dot's place and countdown are reckoned from. */
function useNow(every: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), every);
    return () => clearInterval(timer);
  }, [every]);
  return now;
}

interface Card {
  worker: Worker;
  y: number;
  height: number;
  /** Where its dots stand. */
  dots: Point;
}

function cards(workers: readonly Worker[]): Card[] {
  const gap = 8;
  const height = (252 - (workers.length - 1) * gap) / Math.max(1, workers.length);
  return workers.map((worker, index) => {
    const y = 58 + index * (height + gap);
    const bottom = workers.length === 1 ? y + height / 2 + 30 : y + height - 14;
    return { worker, y, height, dots: [695, bottom] };
  });
}

/** Where the `index`th dot at `place` stands. */
function position(place: Place, index: number, card: Card | undefined): Point {
  if (place === "queue") return [392 + (index % 12) * 16, 120 - Math.floor(index / 12) * 14];
  if (place === "worker") {
    const [x, y] = card?.dots ?? [695, 214];
    return [x + (index % 6) * 16, y];
  }
  const [x, y] = ANCHOR[place];
  return [x + (SPREAD[index % 4] ?? 0), y + Math.floor(index / 4) * 14];
}

/** A worker's name as its card has room for it; the steps' panel names it whole. */
function cut(name: string): string {
  return name.length > 20 ? `${name.slice(0, 19)}…` : name;
}

/** Its pool and what it is doing: "solo · busy", "threads · 3/8 working". */
function Load({ worker, busy }: { worker: Worker; busy: number }) {
  const { t } = useTranslation();
  if (worker.pool === "") return t("staff.system.load.unknown");
  const load =
    worker.concurrency === 1
      ? t(`staff.system.load.${busy > 0 ? "busy" : "idle"}`)
      : t("staff.system.load.some", { busy, concurrency: worker.concurrency });
  return `${worker.pool} · ${load}`;
}

interface DotProps {
  task: Task;
  at: Point;
  fresh: boolean;
  selected: boolean;
  /** The countdown beside a refused question, `null` for any other. */
  label: string | null;
  onSelect: (id: string) => void;
}

function Dot({ task, at, fresh, selected, label, onSelect }: DotProps) {
  // A dot that arrives is drawn at the browser for a frame, then where it is,
  // so it slides in rather than appearing there.
  const [arrived, setArrived] = useState(!fresh);
  useEffect(() => {
    if (arrived) return;
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setArrived(true));
    });
    return () => {
      cancelAnimationFrame(first);
      cancelAnimationFrame(second);
    };
  }, [arrived]);
  const [x, y] = arrived ? at : ANCHOR.browser;
  const style: CSSProperties = { transform: `translate(${x}px, ${y}px)` };
  return (
    // biome-ignore lint/a11y: the pointer's shortcut; the list below selects the same task from the keyboard
    <g
      data-task={task.id}
      style={style}
      onClick={() => onSelect(task.id)}
      className="cursor-pointer transition-transform duration-reveal ease-standard motion-reduce:transition-none"
    >
      <circle r={14} className="fill-transparent" />
      {task.kind === "upload" ? (
        <rect x={-7} y={-7} width={14} height={14} rx={3} className="fill-ink" />
      ) : (
        <circle r={7} className={task.outcome === "refused" ? "fill-warn-line" : "fill-accent"} />
      )}
      {selected && <circle r={11} className="fill-none stroke-2 stroke-ink" />}
      {label !== null && (
        <text x={12} y={-10} className="fill-warn-ink font-semibold text-caption">
          {label}
        </text>
      )}
    </g>
  );
}

interface TopologyProps {
  feed: Feed;
  selected: string | null;
  onSelect: (id: string) => void;
}

export function Topology({ feed, selected, onSelect }: TopologyProps) {
  const { t } = useTranslation();
  const now = useNow(250);
  const workers = cards(shownWorkers(feed));
  const going = feed.tasks.filter((task) => task.outcome === null);
  const waiting = (kind: Task["kind"]) =>
    going.filter((task) => task.kind === kind && task.place === "queue").length;
  const taken = feed.cells.filter((cell) => cell !== null).length;
  const writing = going.some((task) => task.writing);

  // Each place's dots side by side, a worker's on its own card.
  const counted = new Map<string, number>();
  const dots = feed.tasks.flatMap((task) => {
    const place = placeAt(task, now, feed.retryAfterSeconds);
    if (place === null) return [];
    const card = workers.find((each) => each.worker.hostname === task.worker) ?? workers[0];
    const key = place === "worker" ? `worker:${card?.worker.hostname}` : place;
    const index = counted.get(key) ?? 0;
    counted.set(key, index + 1);
    const label =
      task.outcome === "refused"
        ? t("staff.system.retry", { seconds: retryIn(task, now, feed.retryAfterSeconds) })
        : null;
    const fresh = task.seen !== null && now - task.seen < ARRIVING_MS;
    return [{ task, at: position(place, index, card), fresh, label }];
  });

  const count = feed.cells.length;
  const columns = Math.max(1, Math.min(count, 8));
  const rows = Math.ceil(count / columns);
  const cellWidth = Math.min(40, (198 - (columns - 1) * 4) / columns);
  const cellHeight = Math.min(28, (60 - (rows - 1) * 3) / Math.max(1, rows));

  return (
    <div className="overflow-x-auto rounded-card border border-line bg-tint">
      <svg
        viewBox="0 0 1000 340"
        role="img"
        aria-label={t("staff.system.diagram", { taken, cap: feed.cap })}
        className="block h-auto w-full min-w-[45rem]"
      >
        {EDGES.map((edge) => (
          <path
            key={edge.d}
            d={edge.d}
            className={cn(
              "fill-none",
              writing && edge.back ? "stroke-2 stroke-accent" : "stroke-[1.5] stroke-line",
            )}
          />
        ))}
        <rect x={16} y={140} width={120} height={80} rx={12} className={BOX} />
        <text x={76} y={162} textAnchor="middle" className={TITLE}>
          Browser
        </text>
        <text x={76} y={178} textAnchor="middle" className={CAPTION}>
          {t("staff.system.node.browserSub")}
        </text>
        <rect x={176} y={140} width={140} height={80} rx={12} className={BOX} />
        <text x={246} y={162} textAnchor="middle" className={TITLE}>
          {t("staff.system.node.site")}
        </text>
        <text x={246} y={178} textAnchor="middle" className={CAPTION}>
          {t("staff.system.node.siteSub")}
        </text>

        <rect x={356} y={30} width={250} height={290} rx={12} className={BOX} />
        <text x={481} y={52} textAnchor="middle" className={TITLE}>
          Redis
        </text>
        <rect x={370} y={60} width={222} height={80} rx={8} className={PART} />
        <text x={381} y={78} className={CAPTION}>
          {t("staff.system.node.queues", { qa: waiting("question"), ingest: waiting("upload") })}
        </text>
        <rect x={370} y={148} width={222} height={96} rx={8} className={PART} />
        <text x={381} y={166} className={CAPTION}>
          {t(`staff.system.node.${taken >= feed.cap ? "seatsFull" : "seats"}`, {
            taken,
            cap: feed.cap,
          })}
        </text>
        {feed.cells.map((cell, index) => (
          <rect
            // The cells never reorder: a place keeps its cell while it is held.
            // biome-ignore lint/suspicious/noArrayIndexKey: a cell is its position
            key={index}
            x={381 + (index % columns) * (cellWidth + 4)}
            y={174 + Math.floor(index / columns) * (cellHeight + 3)}
            width={cellWidth}
            height={cellHeight}
            rx={4}
            className={cn(
              cell === null && "fill-surface stroke-line",
              cell !== null && !cell.taken && "fill-accent-soft stroke-2 stroke-accent",
              cell?.taken && "fill-accent stroke-accent",
            )}
          />
        ))}
        <rect x={370} y={252} width={222} height={58} rx={8} className={PART} />
        <text x={381} y={270} className={CAPTION}>
          {t("staff.system.node.streams")}
        </text>

        <rect x={646} y={30} width={178} height={290} rx={12} className={BOX} />
        <text x={735} y={52} textAnchor="middle" className={TITLE}>
          {t("staff.system.node.workers")}
        </text>
        {workers.length === 0 && (
          <text x={735} y={180} textAnchor="middle" className={CAPTION}>
            {t("staff.system.node.noWorker")}
          </text>
        )}
        {workers.map(({ worker, y, height }) => {
          const busy = going.filter(
            (task) => task.worker === worker.hostname && task.place !== "queue",
          ).length;
          return (
            <g key={worker.hostname}>
              <rect
                x={656}
                y={y}
                width={158}
                height={height}
                rx={8}
                className={busy > 0 ? "fill-tint stroke-[1.6] stroke-accent" : PART}
              />
              <text x={666} y={y + 18} className={cn(CAPTION, "fill-ink font-semibold")}>
                {cut(worker.hostname)}
              </text>
              <text x={666} y={y + 34} className={CAPTION}>
                {worker.queues.join(" · ")}
              </text>
              <text x={666} y={y + 50} className={CAPTION}>
                <Load worker={worker} busy={busy} />
              </text>
            </g>
          );
        })}

        <rect x={864} y={30} width={124} height={290} rx={12} className={BOX} />
        <text x={926} y={52} textAnchor="middle" className={TITLE}>
          {t("staff.system.node.models")}
        </text>
        {[
          { y: 60, name: "LLM" },
          { y: 148, name: "Qdrant" },
          { y: 236, name: "PostgreSQL" },
        ].map((part) => (
          <g key={part.name}>
            <rect x={876} y={part.y} width={100} height={64} rx={8} className={PART} />
            <text x={926} y={part.y + 24} textAnchor="middle" className={CAPTION}>
              {part.name}
            </text>
          </g>
        ))}

        {dots.map(({ task, at, fresh, label }) => (
          <Dot
            key={task.id}
            task={task}
            at={at}
            fresh={fresh}
            selected={task.id === selected}
            label={label}
            onSelect={onSelect}
          />
        ))}
      </svg>
    </div>
  );
}

/** What the dots and the cells mean, under the diagram. */
export function Legend() {
  const { t } = useTranslation();
  const items = [
    { key: "question", swatch: "rounded-full bg-accent" },
    { key: "upload", swatch: "rounded-[2px] bg-ink" },
    { key: "refused", swatch: "rounded-full bg-warn-line" },
    { key: "waiting", swatch: "border-2 border-accent bg-accent-soft" },
    { key: "answering", swatch: "bg-accent" },
  ];
  return (
    <ul className="flex flex-wrap gap-x-room gap-y-hair text-caption text-muted">
      {items.map((item) => (
        <li key={item.key} className="flex items-center gap-tight">
          <span aria-hidden className={cn("size-2.5 shrink-0", item.swatch)} />
          {t(`staff.system.legend.${item.key}`)}
        </li>
      ))}
    </ul>
  );
}
