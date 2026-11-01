import { describe, expect, it } from "vitest";

import type { ActivityEntry, Snapshot, Worker } from "@/api/system";
import {
  BOUNCE_MS,
  EMPTY,
  type Feed,
  type FeedAction,
  LINGER_MS,
  listed,
  placeAt,
  RECENT,
  reduce,
  retryIn,
  shownWorkers,
} from "./feed";

const SOLO: Worker = {
  hostname: "celery@laptop",
  queues: ["default", "qa", "ingest"],
  pool: "solo",
  concurrency: 1,
};

function entry(
  fields: Partial<ActivityEntry> & Pick<ActivityEntry, "id" | "task" | "event">,
): ActivityEntry {
  return {
    kind: "question",
    worker: null,
    question: null,
    request_id: null,
    step: null,
    ms: null,
    found: null,
    code: null,
    file: null,
    chunks: null,
    ...fields,
  };
}

function snapshot(fields: Partial<Snapshot> = {}): Snapshot {
  return {
    cap: 4,
    retry_after_seconds: 60,
    trace_url: null,
    seats: [],
    workers: [SOLO],
    recent: [],
    ...fields,
  };
}

/** `entries` arriving live, one a second from `from`. */
function live(feed: Feed, entries: ActivityEntry[], from = 1_000): Feed {
  return entries.reduce(
    (state, each, index) => reduce(state, { type: "entry", entry: each, received: from + index }),
    feed,
  );
}

function run(...actions: FeedAction[]): Feed {
  return actions.reduce(reduce, EMPTY);
}

const opened = run({ type: "snapshot", snapshot: snapshot() });

describe("a question", () => {
  const asked = live(opened, [
    entry({ id: "1000-0", task: "a", event: "queued", question: "Quando?", request_id: "r1" }),
  ]);

  it("waits in the queue on a place of its own, its wait under way", () => {
    const [task] = asked.tasks;
    expect(task).toMatchObject({ place: "queue", question: "Quando?", requestId: "r1" });
    expect(task?.steps).toEqual([{ name: "queue", ms: null, since: 1000 }]);
    expect(asked.cells).toEqual([{ answer_id: "a", taken: false }, null, null, null]);
  });

  it("goes through the worker, the model and the index, and back to the browser", () => {
    const by = "celery@laptop";
    const steps = [
      entry({ id: "1200-0", task: "a", event: "taken", worker: by }),
      entry({ id: "1201-0", task: "a", event: "step", step: "queue", ms: 200, worker: by }),
      entry({ id: "1202-0", task: "a", event: "step", step: "route", worker: by }),
    ];
    let feed = live(asked, steps);
    expect(feed.cells[0]).toEqual({ answer_id: "a", taken: true });
    expect(feed.tasks[0]).toMatchObject({ place: "llm", worker: by });

    feed = live(feed, [
      entry({ id: "2400-0", task: "a", event: "step", step: "route", ms: 1200, worker: by }),
      entry({ id: "2401-0", task: "a", event: "step", step: "retrieve", worker: by }),
    ]);
    expect(feed.tasks[0]?.place).toBe("qdrant");

    feed = live(feed, [
      entry({ id: "3200-0", task: "a", event: "step", step: "retrieve", ms: 800, worker: by }),
      entry({ id: "3201-0", task: "a", event: "start", found: 5, worker: by }),
    ]);
    expect(feed.tasks[0]).toMatchObject({ place: "llm", writing: true, found: 5 });

    feed = live(
      feed,
      [
        entry({ id: "8000-0", task: "a", event: "step", step: "generate", ms: 4800, worker: by }),
        entry({ id: "8001-0", task: "a", event: "end", worker: by }),
      ],
      9_000,
    );
    const [task] = feed.tasks;
    expect(task).toMatchObject({ place: "browser", writing: false, outcome: "answered" });
    expect(task?.ended).toBe(9_001);
    expect(task?.steps.map(({ name, ms }) => ({ name, ms }))).toEqual([
      { name: "queue", ms: 200 },
      { name: "route", ms: 1200 },
      { name: "retrieve", ms: 800 },
      { name: "generate", ms: 4800 },
    ]);
    expect(feed.cells).toEqual([null, null, null, null]);
    expect(listed(feed).map((each) => each.last - each.at)).toEqual([7001]);
  });

  it("is drawn at the browser a moment once over, then no more", () => {
    const over = live(asked, [entry({ id: "2000-0", task: "a", event: "stopped" })], 5_000);
    const [task] = over.tasks;
    if (task === undefined) throw new Error("no task");
    expect(placeAt(task, 5_000 + LINGER_MS - 1, 60)).toBe("browser");
    expect(placeAt(task, 5_000 + LINGER_MS, 60)).toBeNull();
  });
});

describe("a refused question", () => {
  const refused = live(
    opened,
    [entry({ id: "1000-0", task: "b", event: "refused", request_id: "r2" })],
    10_000,
  );
  const [task] = refused.tasks;
  if (task === undefined) throw new Error("no task");

  it("holds no place and is over at once", () => {
    expect(refused.cells).toEqual([null, null, null, null]);
    expect(task.outcome).toBe("refused");
  });

  it("bounces off the places, then counts down at its browser until its page asks again", () => {
    expect(placeAt(task, 10_000 + BOUNCE_MS - 1, 60)).toBe("seats");
    expect(placeAt(task, 10_000 + BOUNCE_MS, 60)).toBe("browser");
    expect(retryIn(task, 10_000 + BOUNCE_MS, 60)).toBe(59);
    expect(placeAt(task, 70_000, 60)).toBeNull();
  });
});

describe("a question nobody finished", () => {
  const queued = entry({ id: "1000-0", task: "c", event: "queued", question: "?" });

  it("is lost when the snapshot finds it on no place", () => {
    const feed = run({ type: "snapshot", snapshot: snapshot({ recent: [queued] }) });
    expect(feed.tasks[0]?.outcome).toBe("lost");
  });

  it("is lost when a refresh no longer finds its place, and ends after all when its end comes", () => {
    const asked = live(opened, [queued]);
    const refreshed = reduce(asked, { type: "refresh", refresh: { seats: [], workers: [SOLO] } });
    expect(refreshed.tasks[0]?.outcome).toBe("lost");

    const ended = live(refreshed, [entry({ id: "2000-0", task: "c", event: "end" })]);
    expect(ended.tasks[0]?.outcome).toBe("answered");
  });

  it("gives its place back at the next refresh to the one taken past the cap, the rest unmoved", () => {
    const held = (answer_id: string, taken: boolean) => ({ answer_id, taken });
    const full = run({
      type: "snapshot",
      snapshot: snapshot({ cap: 2, seats: [held("a", true), held("b", true)] }),
    });
    // a's lease runs out, which writes no entry, and d takes the place it freed.
    const crowded = live(full, [entry({ id: "1000-0", task: "d", event: "queued" })]);
    expect(crowded.cells).toHaveLength(3);

    const refresh = { seats: [held("b", true), held("d", false)], workers: [SOLO] };
    expect(reduce(crowded, { type: "refresh", refresh }).cells).toEqual([
      held("d", false),
      held("b", true),
    ]);
  });

  it("keeps no empty cell past the cap when a place there is given up", () => {
    const held = (answer_id: string) => ({ answer_id, taken: true });
    const lowered = run({
      type: "snapshot",
      snapshot: snapshot({ cap: 2, seats: ["a", "b", "c", "d"].map(held) }),
    });
    const ended = live(lowered, [entry({ id: "1000-0", task: "c", event: "end" })]);
    expect(ended.cells).toEqual(["a", "b", "d"].map(held));
  });
});

describe("the workers", () => {
  it("keep the one a task is on, which a refresh left out while it ran", () => {
    const busy = live(opened, [
      entry({ id: "1000-0", task: "d", event: "queued" }),
      entry({ id: "1001-0", task: "d", event: "taken", worker: SOLO.hostname }),
    ]);
    const refreshed = reduce(busy, {
      type: "refresh",
      refresh: { seats: [{ answer_id: "d", taken: true }], workers: [] },
    });
    expect(shownWorkers(refreshed)).toEqual([SOLO]);

    const done = live(refreshed, [entry({ id: "2000-0", task: "d", event: "end" })]);
    expect(shownWorkers(done)).toEqual([]);
  });

  it("draw one never seen by its name alone", () => {
    const feed = live(opened, [
      entry({ id: "1000-0", task: "e", event: "queued" }),
      entry({ id: "1001-0", task: "e", event: "taken", worker: "qa@micc" }),
    ]);
    expect(
      shownWorkers(reduce(feed, { type: "refresh", refresh: { seats: [], workers: [] } })),
    ).toEqual([]);
    expect(shownWorkers({ ...feed, online: [] })).toEqual([
      { hostname: "qa@micc", queues: [], pool: "", concurrency: 0 },
    ]);
  });
});

describe("an upload", () => {
  const upload = (fields: Partial<ActivityEntry> & Pick<ActivityEntry, "id" | "event">) =>
    entry({ kind: "upload", task: "m", ...fields });

  it("takes its steps' times from its statuses, and its passages from indexing", () => {
    const feed = live(opened, [
      upload({ id: "1000-0", event: "queued", file: "Lezione 08.pdf" }),
      upload({ id: "1300-0", event: "parsing", worker: SOLO.hostname }),
      upload({ id: "4500-0", event: "chunking", worker: SOLO.hostname }),
      upload({ id: "5700-0", event: "indexing", chunks: 214, worker: SOLO.hostname }),
    ]);
    expect(feed.tasks[0]).toMatchObject({ place: "qdrant", chunks: 214, file: "Lezione 08.pdf" });

    const ready = live(feed, [upload({ id: "7700-0", event: "ready", worker: SOLO.hostname })]);
    expect(ready.tasks[0]).toMatchObject({ outcome: "ready", place: "browser" });
    expect(ready.tasks[0]?.steps).toEqual([
      { name: "queue", ms: 300 },
      { name: "parsing", ms: 3200 },
      { name: "chunking", ms: 1200 },
      { name: "indexing", ms: 2000 },
    ]);
    // No upload holds a place, so none is ever lost.
    expect(ready.cells).toEqual([null, null, null, null]);
  });

  it("keeps the step it failed in unfinished", () => {
    const feed = live(opened, [
      upload({ id: "1000-0", event: "queued", file: "x.pdf" }),
      upload({ id: "1300-0", event: "parsing" }),
      upload({ id: "2000-0", event: "failed", code: "unreadable" }),
    ]);
    expect(feed.tasks[0]).toMatchObject({ outcome: "failed", code: "unreadable" });
    expect(feed.tasks[0]?.steps.at(-1)).toMatchObject({ name: "parsing", ms: null });
  });
});

describe("the list", () => {
  it("keeps what is under way and the last finished, those under way first", () => {
    const finished = Array.from({ length: RECENT + 2 }, (_, index) =>
      entry({ id: `${1000 + index}-0`, task: `r${index}`, event: "refused" }),
    );
    const feed = live(opened, [
      ...finished,
      entry({ id: "500-0", task: "going", event: "queued" }),
    ]);
    const tasks = listed(feed);
    expect(tasks).toHaveLength(RECENT + 1);
    expect(tasks[0]?.id).toBe("going");
    expect(tasks[1]?.id).toBe(`r${RECENT + 1}`);
    expect(tasks.at(-1)?.id).toBe("r2");
  });
});
