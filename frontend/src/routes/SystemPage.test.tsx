// @vitest-environment jsdom

/**
 * The superuser's system page (#236), with the feed faked at `fetch`: that
 * the page is nobody else's; the tasks the snapshot holds and those arriving
 * live, listed with their outcome; a task's steps, worker, request and trace
 * once picked, and a visitor's question without them; and a feed that breaks
 * opened again, where one that never opened is the page's failure.
 */

import { act } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/api/account";
import type { ActivityEntry, Snapshot } from "@/api/system";
import { SessionContext } from "@/auth/SessionProvider";
import { REOPEN_MS } from "@/features/system/useActivity";
import { mount } from "@/test/mount";
import { codedRefusal } from "@/test/refusal";
import { ThemeProvider } from "@/theme/ThemeProvider";
import SystemPage from "./SystemPage";
import { type Shell, ShellContext } from "./shell";

const ADMIN: Account = {
  id: 1,
  username: "demo-admin",
  locale: "it",
  is_superuser: true,
  roles: [],
  programme: null,
  year_of_study: null,
};

const SHELL: Shell = {
  programmes: [],
  programmesError: null,
  landing: null,
  root: "programmes",
  back: { to: "/staff/programmes", label: "" },
  setTrail: () => {},
  refreshConversations: () => {},
  setBusy: () => {},
};

const WORKER = "celery@laptop";
const REQUEST = "4bf92f3577b34da6a3ce929d0e0e4736";

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

/** A student's question answered, a visitor's, and an upload still being parsed. */
const RECENT: ActivityEntry[] = [
  entry({ id: "1000-0", task: "a", event: "queued", question: "Quando?", request_id: REQUEST }),
  entry({ id: "1100-0", task: "a", event: "taken", worker: WORKER }),
  entry({ id: "1101-0", task: "a", event: "step", step: "queue", ms: 1500, worker: WORKER }),
  entry({ id: "2300-0", task: "a", event: "step", step: "route", ms: 1200, worker: WORKER }),
  entry({ id: "3100-0", task: "a", event: "step", step: "retrieve", ms: 800, worker: WORKER }),
  entry({ id: "3101-0", task: "a", event: "start", found: 5, worker: WORKER }),
  entry({ id: "8000-0", task: "a", event: "step", step: "generate", ms: 4900, worker: WORKER }),
  entry({ id: "8001-0", task: "a", event: "end", worker: WORKER }),
  entry({ id: "9000-0", task: "v", event: "queued", request_id: "f".repeat(32) }),
  entry({ id: "9500-0", task: "v", event: "end", worker: WORKER }),
  entry({ id: "9600-0", kind: "upload", task: "m", event: "queued", file: "Lezione 08.pdf" }),
  entry({ id: "9900-0", kind: "upload", task: "m", event: "parsing", worker: WORKER }),
];

const SNAPSHOT: Snapshot = {
  cap: 4,
  retry_after_seconds: 60,
  trace_url: "http://localhost:3000/trace/",
  seats: [],
  workers: [
    { hostname: WORKER, queues: ["default", "ingest", "qa"], pool: "solo", concurrency: 1 },
  ],
  recent: RECENT,
};

function frame(name: string, data: unknown, id?: string): string {
  return `${id === undefined ? "" : `id: ${id}\n`}event: ${name}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** A feed's body that stays open for the test to write into, or end. */
function pipe() {
  const encoder = new TextEncoder();
  let writer: ReadableStreamDefaultController<Uint8Array> | null = null;
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      writer = controller;
    },
  });
  return {
    body,
    write: (frames: string) => writer?.enqueue(encoder.encode(frames)),
    end: () => writer?.close(),
  };
}

let feeds: ReturnType<typeof pipe>[];
let answer: () => Response;
const fetched: string[] = [];

function opened(): Response {
  const feed = pipe();
  feeds.push(feed);
  feed.write(frame("snapshot", SNAPSHOT));
  return new Response(feed.body, { headers: { "Content-Type": "text/event-stream" } });
}

beforeEach(() => {
  feeds = [];
  fetched.length = 0;
  answer = opened;
  vi.stubGlobal("fetch", async (input: RequestInfo | URL) => {
    fetched.push(String(input));
    return answer();
  });
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

async function settle() {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function open(reader: Account = ADMIN) {
  const router = createMemoryRouter([{ path: "/staff/system", element: <SystemPage /> }], {
    initialEntries: ["/staff/system"],
  });
  const mounted = mount(
    <ThemeProvider>
      <SessionContext
        value={{
          account: reader,
          logIn: async () => {},
          register: async () => {},
          logOut: async () => {},
          chooseLocale: async () => {},
          chooseStudies: async () => {},
          forget: () => {},
          recheck: async () => {},
        }}
      >
        <ShellContext value={SHELL}>
          <RouterProvider router={router} />
        </ShellContext>
      </SessionContext>
    </ThemeProvider>,
  );
  await settle();
  return mounted;
}

function rows(container: HTMLElement): string[] {
  return [...container.querySelectorAll("tbody tr")].map((row) =>
    [...row.querySelectorAll("td")]
      .map((cell) => (cell.querySelector("button, .rounded-chip")?.textContent ?? "").trim())
      .filter(Boolean)
      .join(" | "),
  );
}

function pick(container: HTMLElement, name: string) {
  const button = [...container.querySelectorAll<HTMLButtonElement>("tbody button")].find(
    (each) => each.textContent === name,
  );
  if (button === undefined) throw new Error(`no row ${name}`);
  act(() => button.click());
}

function panel(container: HTMLElement): HTMLElement {
  const found = container.querySelector<HTMLElement>('section[aria-label="Passaggi"]');
  if (found === null) throw new Error("no panel");
  return found;
}

describe("the system page", () => {
  it("is not found for anyone but the superuser, and asks the server for nothing", async () => {
    const { container } = await open({ ...ADMIN, is_superuser: false, roles: [] });
    expect(container.querySelector("h1")?.textContent).not.toBe("Sistema");
    expect(fetched).toEqual([]);
  });

  it("lists what the snapshot holds, those under way first", async () => {
    const { container } = await open();
    expect(container.textContent).toContain("In diretta");
    expect(rows(container)).toEqual([
      "PDF · Lezione 08.pdf | In corso",
      "Domanda di un visitatore | Risposta",
      "Quando? | Risposta",
    ]);
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toContain("0 su 4");
  });

  it("shows a question's steps, its worker, its request and its trace once picked", async () => {
    const { container } = await open();
    pick(container, "Quando?");
    const steps = panel(container);
    expect([...steps.querySelectorAll("li")].map((li) => li.textContent)).toEqual([
      "Atteso il turno1,5 s",
      "Domanda capita1,2 s",
      "Trovati 5 estratti0,8 s",
      "Risposta scritta4,9 s",
    ]);
    expect(steps.textContent).toContain(`Worker: ${WORKER}`);
    expect(steps.querySelector("code")?.textContent).toBe(REQUEST);
    expect(steps.querySelector("a")?.getAttribute("href")).toBe(
      `http://localhost:3000/trace/${REQUEST}`,
    );
  });

  it("shows a visitor's question without a request or a trace", async () => {
    const { container } = await open();
    pick(container, "Domanda di un visitatore");
    expect(panel(container).querySelector("code")).toBeNull();
    expect(panel(container).querySelector("a")).toBeNull();
  });

  it("shows no trace for a question no worker answered: refused, or stopped as it was taken", async () => {
    const { container } = await open();
    const asked = (task: string, question: string) =>
      entry({
        id: `2${task === "r" ? 0 : 1}000-0`,
        task,
        question,
        request_id: REQUEST,
        event: "queued",
      });
    act(() => {
      feeds[0]?.write(
        frame("activity", { ...asked("r", "Piena?"), event: "refused" }) +
          frame("activity", asked("s", "Fermata?")) +
          frame("activity", entry({ id: "21100-0", task: "s", event: "taken", worker: WORKER })) +
          frame("activity", entry({ id: "21101-0", task: "s", event: "stopped", worker: WORKER })),
      );
    });
    await settle();
    for (const question of ["Piena?", "Fermata?"]) {
      pick(container, question);
      expect(panel(container).querySelector("code")?.textContent).toBe(REQUEST);
      expect(panel(container).querySelector("a")).toBeNull();
    }
  });

  it("shows an upload's step under way, and the passages once it is cut", async () => {
    const { container } = await open();
    pick(container, "PDF · Lezione 08.pdf");
    expect(panel(container).textContent).toContain("Legge il PDF");

    act(() => {
      feeds[0]?.write(
        frame(
          "activity",
          entry({ id: "12000-0", kind: "upload", task: "m", event: "chunking", worker: WORKER }),
          "12000-0",
        ) +
          frame(
            "activity",
            entry({ id: "13000-0", kind: "upload", task: "m", event: "indexing", chunks: 214 }),
            "13000-0",
          ),
      );
    });
    await settle();
    expect(panel(container).textContent).toContain("PDF letto");
    expect(panel(container).textContent).toContain("Diviso in 214 passaggi");
    expect(panel(container).textContent).toContain("Lo rende cercabile");
  });

  it("adds a question as it arrives, and says how it ended", async () => {
    const { container } = await open();
    act(() => {
      feeds[0]?.write(
        frame("activity", entry({ id: "20000-0", task: "n", event: "queued", question: "Nuova?" })),
      );
    });
    await settle();
    expect(rows(container)[0]).toBe("Nuova? | In corso");
    expect(container.querySelector("svg")?.getAttribute("aria-label")).toContain("1 su 4");

    act(() => {
      feeds[0]?.write(frame("activity", entry({ id: "21000-0", task: "n", event: "stopped" })));
    });
    await settle();
    expect(rows(container)).toContain("Nuova? | Fermata");
  });

  it("opens a feed that ended again, keeping what it drew meanwhile", async () => {
    const { container } = await open();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    act(() => feeds[0]?.end());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(0);
    });
    expect(container.textContent).toContain("Riconnessione…");
    expect(rows(container)).toHaveLength(3);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(REOPEN_MS);
    });
    vi.useRealTimers();
    await settle();
    expect(fetched).toHaveLength(2);
    expect(container.textContent).toContain("In diretta");
  });

  it("says why once the feed it opens again is refused, rather than opening it on and on", async () => {
    const { container } = await open();
    vi.useFakeTimers({ toFake: ["setTimeout"] });
    // The reader is no longer a superuser: the server ended the feed, and refuses the next.
    answer = () => codedRefusal("PERMISSION_DENIED");
    act(() => feeds[0]?.end());
    await act(async () => {
      await vi.advanceTimersByTimeAsync(REOPEN_MS * 3);
    });
    vi.useRealTimers();
    await settle();
    expect(fetched).toHaveLength(2);
    expect(container.querySelector("h1")?.textContent).not.toBe("Sistema");
  });

  it("says why a feed that never opened failed, and opens it on Riprova", async () => {
    answer = () => codedRefusal("INTERNAL");
    const { container } = await open();
    expect(container.querySelector("h1")?.textContent).not.toBe("Sistema");
    const retry = [...container.querySelectorAll("button")].find(
      (button) => button.textContent === "Riprova",
    );
    answer = opened;
    act(() => retry?.click());
    await settle();
    expect(container.querySelector("h1")?.textContent).toBe("Sistema");
    expect(rows(container)).toHaveLength(3);
  });
});
