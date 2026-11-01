/**
 * The system page's state (#236): the feed of `/api/admin/activity`
 * (api/system.ts) folded into the tasks it follows, the places under the
 * global cap and the workers, for the page to draw (routes/SystemPage.tsx).
 *
 * A task is a question or an upload, named by its answer's or its material's
 * id. Its entries move it through the diagram's nodes (`Place`) and build its
 * steps, the list the chat shows (features/chat/StepList.tsx): a question's
 * are its answer's `step` events, with the wait in the queue begun by
 * `queued` and the writing by `start`, as the chat begins them; an upload's
 * are the time between its ingest's statuses, read off the entries' ids.
 *
 * Three things no entry says, read from what the server does (apps/system/):
 * - A question under way that holds no place after a snapshot or a refresh
 *   was lost: its lease ran out, or no worker took it. It is listed as over;
 *   an entry that ends it after all still says how.
 * - A solo worker running a task does not answer `inspect`, so a refresh may
 *   leave out the very worker a task is on: a worker named by a task under
 *   way is drawn from what was last seen of it.
 * - A refused question is retried by its page as a new request, so a new
 *   task: the refused one is drawn until its page's countdown ends.
 *
 * Pure: the time an entry arrived is the action's, so a test needs no clock.
 */

import type { ActivityEntry, Refresh, Seat, Snapshot, Worker } from "@/api/system";
import type { Step } from "@/features/chat/StepList";

/** Where a task is drawn: a node of the diagram, or a part of one. */
export type Place = "browser" | "queue" | "seats" | "worker" | "llm" | "qdrant";

export type Outcome = "answered" | "stopped" | "error" | "refused" | "lost" | "ready" | "failed";

export interface Task {
  kind: ActivityEntry["kind"];
  id: string;
  /** When its first entry and its last were written, in ms since the epoch, by the server's clock. */
  at: number;
  last: number;
  /**
   * When its first entry and its ending reached the page, by the page's
   * clock: `null` for what the snapshot held, which is not drawn arriving.
   */
  seen: number | null;
  ended: number | null;
  /** A signed-in asker's opening words; `null` for a visitor's question, and for an upload. */
  question: string | null;
  file: string | null;
  requestId: string | null;
  worker: string | null;
  steps: Step[];
  found: number | null;
  chunks: number | null;
  /** Where it is while under way, and where it rests once over. */
  place: Place;
  /** Its answer is being written, so the stream back to the browser is busy. */
  writing: boolean;
  /**
   * A worker began answering it: what a signed-in question's trace records
   * (apps/qa/tasks.py). One refused, lost, or stopped as it was taken has none.
   */
  answering: boolean;
  outcome: Outcome | null;
  code: string | null;
}

export interface Feed {
  cap: number;
  retryAfterSeconds: number;
  traceUrl: string | null;
  /** The places under the cap, each keeping its cell while it is held; `null` is free. */
  cells: (Seat | null)[];
  /** The workers that answered the last `inspect`. */
  online: Worker[];
  /** The last seen of every worker, by its name. */
  known: Record<string, Worker>;
  /** Oldest first: those under way, and the last `RECENT` over. */
  tasks: Task[];
}

export type FeedAction =
  | { type: "snapshot"; snapshot: Snapshot }
  | { type: "entry"; entry: ActivityEntry; received: number }
  | { type: "refresh"; refresh: Refresh };

/** The finished tasks kept, as many as the snapshot sends (apps/system/activity.py). */
export const RECENT = 20;

/** How long a refused question takes to bounce off the full places back to its browser. */
export const BOUNCE_MS = 1000;

/** How long a finished task stays drawn at the browser before it goes. */
export const LINGER_MS = 2500;

export const EMPTY: Feed = {
  cap: 0,
  retryAfterSeconds: 0,
  traceUrl: null,
  cells: [],
  online: [],
  known: {},
  tasks: [],
};

/** When an entry was written: the first part of its stream id. */
export function timeOf(id: string): number {
  return Number(id.split("-")[0]);
}

function begun(steps: readonly Step[], name: Step["name"], since: number): Step[] {
  if (steps.some((step) => step.name === name && step.ms === null)) return [...steps];
  return [...steps, { name, ms: null, since }];
}

/** `name` over: in place of its beginning when it had one, last otherwise. */
function ended(steps: readonly Step[], name: Step["name"], ms: number): Step[] {
  const at = steps.findIndex((step) => step.name === name && step.ms === null);
  if (at === -1) return [...steps, { name, ms }];
  return steps.map((step, index) => (index === at ? { name, ms } : step));
}

/** An upload's step `name` over at `at`, timed from its beginning; unchanged without one. */
function closed(steps: readonly Step[], name: Step["name"], at: number): Step[] {
  const open = steps.find((step) => step.name === name && step.ms === null);
  if (open?.since === undefined) return [...steps];
  return ended(steps, name, Math.max(0, at - open.since));
}

function blank(entry: ActivityEntry, received: number | null): Task {
  const at = timeOf(entry.id);
  return {
    kind: entry.kind,
    id: entry.task,
    at,
    last: at,
    seen: received,
    ended: null,
    question: null,
    file: null,
    requestId: null,
    worker: null,
    steps: [],
    found: null,
    chunks: null,
    place: "browser",
    writing: false,
    answering: false,
    outcome: null,
    code: null,
  };
}

function question(task: Task, entry: ActivityEntry, at: number, received: number | null): Task {
  switch (entry.event) {
    case "queued":
      return {
        ...task,
        question: entry.question,
        requestId: entry.request_id,
        steps: begun(task.steps, "queue", at),
        place: "queue",
      };
    case "refused":
      return {
        ...task,
        question: entry.question,
        requestId: entry.request_id,
        place: "browser",
        outcome: "refused",
        ended: received,
      };
    case "taken":
      return { ...task, place: "worker" };
    case "step": {
      if (entry.step === null) return task;
      if (entry.ms === null) {
        const place =
          entry.step === "route" ? "llm" : entry.step === "retrieve" ? "qdrant" : task.place;
        return { ...task, steps: begun(task.steps, entry.step, at), place, answering: true };
      }
      const writing = entry.step === "generate" ? false : task.writing;
      const steps = ended(task.steps, entry.step, entry.ms);
      return { ...task, steps, place: "worker", writing, answering: true };
    }
    case "start":
      return {
        ...task,
        answering: true,
        found: entry.found,
        steps: begun(task.steps, "generate", at),
        place: "llm",
        writing: true,
      };
    case "end":
    case "stopped":
    case "error":
      return {
        ...task,
        place: "browser",
        writing: false,
        outcome: entry.event === "end" ? "answered" : entry.event,
        code: entry.code,
        ended: received,
      };
    default:
      return task;
  }
}

function upload(task: Task, entry: ActivityEntry, at: number, received: number | null): Task {
  switch (entry.event) {
    case "queued":
      return { ...task, file: entry.file, steps: begun(task.steps, "queue", at), place: "queue" };
    case "parsing":
      return {
        ...task,
        steps: begun(closed(task.steps, "queue", at), "parsing", at),
        place: "worker",
      };
    case "chunking":
      return {
        ...task,
        steps: begun(closed(task.steps, "parsing", at), "chunking", at),
        place: "worker",
      };
    case "indexing":
      return {
        ...task,
        chunks: entry.chunks,
        steps: begun(closed(task.steps, "chunking", at), "indexing", at),
        place: "qdrant",
      };
    case "ready":
      return {
        ...task,
        steps: closed(task.steps, "indexing", at),
        place: "browser",
        outcome: "ready",
        ended: received,
      };
    case "failed":
      return { ...task, place: "browser", outcome: "failed", code: entry.code, ended: received };
    default:
      return task;
  }
}

/** `task` after `entry`; a new one when `task` is `undefined`. */
function applied(task: Task | undefined, entry: ActivityEntry, received: number | null): Task {
  const at = timeOf(entry.id);
  const before = task ?? blank(entry, received);
  const moved =
    entry.kind === "question"
      ? question(before, entry, at, received)
      : upload(before, entry, at, received);
  return { ...moved, last: Math.max(before.last, at), worker: entry.worker ?? before.worker };
}

/** The places `seats` hold, each in the cell it already had, a new one in the first free. */
function placed(
  cells: readonly (Seat | null)[],
  seats: readonly Seat[],
  cap: number,
): (Seat | null)[] {
  const held = new Map(seats.map((seat) => [seat.answer_id, seat]));
  const next: (Seat | null)[] = cells.map((cell) =>
    cell === null ? null : (held.get(cell.answer_id) ?? null),
  );
  while (next.length < cap) next.push(null);
  for (const seat of seats) {
    if (next.some((cell) => cell?.answer_id === seat.answer_id)) continue;
    const free = next.indexOf(null);
    // More places than the cap: a cap lowered under leases still held, or a
    // place taken before a refresh told of the lease that freed it.
    if (free === -1) next.push(seat);
    else next[free] = seat;
  }
  // Past the cap, a cell given up goes rather than stays empty.
  for (let at = next.length - 1; next.length > cap && at >= 0; at -= 1) {
    if (next[at] === null) next.splice(at, 1);
  }
  return next;
}

function seatsOf(cells: readonly (Seat | null)[]): Seat[] {
  return cells.filter((cell) => cell !== null);
}

/** The places after a question's `entry`: one taken on `queued`, given up on its end. */
function reseated(feed: Feed, entry: ActivityEntry): (Seat | null)[] {
  if (entry.kind !== "question") return feed.cells;
  const seats = seatsOf(feed.cells);
  const id = entry.task;
  switch (entry.event) {
    case "queued":
      return placed(feed.cells, [...seats, { answer_id: id, taken: false }], feed.cap);
    case "taken":
      return placed(
        feed.cells,
        seats.map((seat) => (seat.answer_id === id ? { ...seat, taken: true } : seat)),
        feed.cap,
      );
    case "end":
    case "stopped":
    case "error":
      return placed(
        feed.cells,
        seats.filter((seat) => seat.answer_id !== id),
        feed.cap,
      );
    default:
      return feed.cells;
  }
}

/** A question under way that holds no place is lost. */
function settled(tasks: readonly Task[], cells: readonly (Seat | null)[]): Task[] {
  const held = new Set(seatsOf(cells).map((seat) => seat.answer_id));
  return tasks.map((task) =>
    task.kind === "question" && task.outcome === null && !held.has(task.id)
      ? { ...task, place: "browser", writing: false, outcome: "lost" }
      : task,
  );
}

/** Those under way, and the last `RECENT` over, oldest first. */
function pruned(tasks: readonly Task[]): Task[] {
  const over = tasks
    .filter((task) => task.outcome !== null)
    .sort((a, b) => b.last - a.last)
    .slice(0, RECENT);
  const kept = new Set(over);
  return tasks.filter((task) => task.outcome === null || kept.has(task));
}

function remembered(
  known: Record<string, Worker>,
  workers: readonly Worker[],
): Record<string, Worker> {
  return { ...known, ...Object.fromEntries(workers.map((worker) => [worker.hostname, worker])) };
}

export function reduce(feed: Feed, action: FeedAction): Feed {
  switch (action.type) {
    case "snapshot": {
      const { snapshot } = action;
      const byId = new Map<string, Task>();
      for (const entry of snapshot.recent) {
        byId.set(entry.task, applied(byId.get(entry.task), entry, null));
      }
      const cells = placed([], snapshot.seats, snapshot.cap);
      return {
        cap: snapshot.cap,
        retryAfterSeconds: snapshot.retry_after_seconds,
        traceUrl: snapshot.trace_url,
        cells,
        online: snapshot.workers,
        known: remembered(feed.known, snapshot.workers),
        tasks: pruned(settled([...byId.values()], cells)),
      };
    }
    case "entry": {
      const { entry, received } = action;
      const at = feed.tasks.findIndex((task) => task.id === entry.task);
      const task = applied(at === -1 ? undefined : feed.tasks[at], entry, received);
      const tasks =
        at === -1 ? [...feed.tasks, task] : feed.tasks.map((each, i) => (i === at ? task : each));
      return { ...feed, cells: reseated(feed, entry), tasks: pruned(tasks) };
    }
    case "refresh": {
      const { refresh } = action;
      const cells = placed(feed.cells, refresh.seats, feed.cap);
      return {
        ...feed,
        cells,
        online: refresh.workers,
        known: remembered(feed.known, refresh.workers),
        tasks: settled(feed.tasks, cells),
      };
    }
  }
}

/** The workers to draw: those online, and any a task under way is on that did not answer. */
export function shownWorkers(feed: Feed): Worker[] {
  const shown = [...feed.online];
  for (const task of feed.tasks) {
    const name = task.worker;
    if (task.outcome !== null || name === null) continue;
    if (shown.some((worker) => worker.hostname === name)) continue;
    shown.push(feed.known[name] ?? { hostname: name, queues: [], pool: "", concurrency: 0 });
  }
  return shown;
}

/** Where `task` is drawn at `now`, or `null` once it is no longer drawn. */
export function placeAt(task: Task, now: number, retryAfterSeconds: number): Place | null {
  if (task.outcome === null) return task.place;
  if (task.ended === null) return null;
  const since = now - task.ended;
  if (task.outcome === "refused") {
    if (since >= retryAfterSeconds * 1000) return null;
    return since < BOUNCE_MS ? "seats" : "browser";
  }
  return since < LINGER_MS ? "browser" : null;
}

/** The whole seconds before a refused question's page asks again. */
export function retryIn(task: Task, now: number, retryAfterSeconds: number): number {
  return Math.max(0, Math.ceil((retryAfterSeconds * 1000 - (now - (task.ended ?? now))) / 1000));
}

/** The tasks the page lists: those under way, newest first, then the finished, last over first. */
export function listed(feed: Feed): Task[] {
  const going = feed.tasks.filter((task) => task.outcome === null).sort((a, b) => b.at - a.at);
  const over = feed.tasks.filter((task) => task.outcome !== null).sort((a, b) => b.last - a.last);
  return [...going, ...over];
}
