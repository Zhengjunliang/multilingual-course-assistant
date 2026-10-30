// @vitest-environment jsdom

/**
 * An edition's material tab as its page holds it, over a server faked at
 * `fetch` that answers as apps/materials/views.py does and moves each row
 * on a step every time the list is read: what is sent and when, what asks
 * first, why a file was not sent, and for how long the list is read again.
 */

import { act, useCallback } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { type CourseMaterial, listMaterials, MAX_UPLOAD_MIB } from "@/api/catalog";
import { codedRefusal } from "@/test/refusal";
import { useLoad } from "../context";
import { BASE, button, mountForReader, settle, text } from "./harness";
import { MaterialPanel } from "./MaterialPanel";
import { POLL_MS } from "./materials";

const INTRO: CourseMaterial = {
  id: 1,
  source_file: "01-Intro.pdf",
  status: "ready",
  failure: "",
  uploaded_by: "demo-teacher",
  created_at: "2026-10-30T09:00:00Z",
  started_at: "2026-10-30T09:00:01Z",
  finished_at: "2026-10-30T09:00:30Z",
};

/** The step a read moves a row on to. */
const NEXT: Partial<Record<CourseMaterial["status"], CourseMaterial["status"]>> = {
  queued: "indexing",
  indexing: "ready",
};

/** The name of a file the edition holds the bytes of. */
const HELD_BYTES = "same-bytes.pdf";

/** The name of a file of more pages than the server takes. */
const TOO_LONG = "long.pdf";

const server = {
  rows: [] as CourseMaterial[],
  reads: 0,
  /** The name of every file sent, in order. */
  sent: [] as string[],
};

async function fakeApi(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  if (String(input) !== `${BASE}/materials`) return codedRefusal("NOT_FOUND");
  if ((init.method ?? "GET") === "GET") {
    server.reads += 1;
    const shown = server.rows;
    server.rows = shown.map((row) => ({ ...row, status: NEXT[row.status] ?? row.status }));
    return Response.json(shown);
  }
  const file = (init.body as FormData).get("file") as File;
  server.sent.push(file.name);
  if (file.name === HELD_BYTES) return codedRefusal("MATERIAL_EXISTS", { data: { material: 1 } });
  if (file.name === TOO_LONG)
    return codedRefusal("INVALID_ARGUMENT", {
      fields: [{ field: "file", reason: "TOO_MANY_PAGES", data: { max_pages: 300 } }],
    });
  const row: CourseMaterial = {
    ...INTRO,
    id: 10 + server.sent.length,
    source_file: file.name,
    status: "queued",
  };
  server.rows = [row, ...server.rows];
  return Response.json(row, { status: 202 });
}

function Tab() {
  const load = useCallback(() => listMaterials(5), []);
  const materials = useLoad(load);
  return <MaterialPanel edition={5} materials={materials} reloadPage={async () => true} />;
}

const pdf = (name: string) => new File(["%PDF-1.7"], name, { type: "application/pdf" });

/** Chooses `files` in the panel's picker, as the browser's file dialog does. */
function choose(files: File[]) {
  const input = document.body.querySelector<HTMLInputElement>('input[type="file"]');
  if (input === null) throw new Error("no file picker");
  Object.defineProperty(input, "files", { value: files, configurable: true });
  act(() => {
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

/** The state a row shows, by the file's name. */
function stateOf(name: string) {
  const row = [...document.body.querySelectorAll("tbody tr")].find(
    (candidate) => text(candidate.querySelector("td span")) === name,
  );
  return text(row?.querySelector("td:nth-child(2)"));
}

beforeEach(() => {
  server.rows = [INTRO];
  server.reads = 0;
  server.sent = [];
  vi.stubGlobal("fetch", fakeApi);
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("the material tab", () => {
  it("reads the list again while a file is on its way, and no longer once every one is ready", async () => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    server.rows = [{ ...INTRO, id: 2, source_file: "02-Django.pdf", status: "queued" }, INTRO];
    const { unmount } = mountForReader(<Tab />);
    const seen: [number, string][] = [];
    for (let read = 0; read < 3; read += 1) {
      await act(() => vi.advanceTimersByTimeAsync(read === 0 ? 0 : POLL_MS));
      seen.push([server.reads, stateOf("02-Django.pdf")]);
    }
    await act(() => vi.advanceTimersByTimeAsync(POLL_MS * 4));
    const reads = server.reads;
    unmount();

    expect(seen).toEqual([
      [1, "In coda"],
      [2, "Indicizzazione"],
      [3, "Pronto"],
    ]);
    expect(reads).toBe(3);
  });

  it("sends a file of a new name at once, and one of a name the edition holds once the reader confirms", async () => {
    const { unmount } = mountForReader(<Tab />);
    await settle();
    choose([pdf("02-Django.pdf"), pdf("01-Intro.pdf")]);
    await settle();
    const asked = {
      sent: [...server.sent],
      question: text(document.body.querySelector('[role="alertdialog"] p')),
    };
    act(() => button("Sostituisci")?.click());
    await settle();
    const sent = [...server.sent];
    unmount();

    expect(asked.sent).toEqual(["02-Django.pdf"]);
    expect(asked.question).toContain("01-Intro.pdf");
    expect(sent).toEqual(["02-Django.pdf", "01-Intro.pdf"]);
  });

  it("says why each file was not sent, and sends the rest", async () => {
    const huge = pdf("huge.pdf");
    Object.defineProperty(huge, "size", { value: MAX_UPLOAD_MIB * 1024 * 1024 + 1 });
    const { unmount } = mountForReader(<Tab />);
    await settle();
    choose([
      pdf(HELD_BYTES),
      new File(["notes"], "notes.txt", { type: "text/plain" }),
      huge,
      pdf(TOO_LONG),
      pdf("03-ORM.pdf"),
    ]);
    await settle();
    const seen = {
      sent: [...server.sent],
      unsent: [...document.body.querySelectorAll('[role="alert"] li')].map((item) => text(item)),
    };
    unmount();

    expect(seen).toEqual({
      sent: [HELD_BYTES, TOO_LONG, "03-ORM.pdf"],
      unsent: [
        "notes.txt · Non è un PDF.",
        "huge.pdf · Il file è troppo grande: al massimo 50 MB.",
        `${HELD_BYTES} · Questo file è già tra i materiali dell'edizione.`,
        `${TOO_LONG} · Al massimo 300 pagine: dividi il file.`,
      ],
    });
  });
});
