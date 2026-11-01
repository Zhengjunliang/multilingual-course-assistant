/**
 * The steps an answer took (#236), in the reader's words, each with its time.
 *
 * A step is named for what it does to the question, never for the machine
 * doing it: "In coda", "Capisce la domanda", "Cerca nel materiale", "Scrive la
 * risposta". No worker, no GPU: the wait for the GPU is part of the search,
 * and is told apart only in the trace. Perplexity's and Open WebUI's steps
 * speak to the student the same way (read 1 November 2026).
 *
 * The step under way turns and counts, its words shimmering as the process
 * line's did before it had steps; one finished is ticked, with the server's
 * time. A wait in the queue under a second is dropped once over: nobody
 * noticed it, and a row of it would only say the server was idle.
 *
 * The same list is the process line's while the answer is searched for, and
 * its timeline's once it has been; the superuser's system page lists an
 * answer's steps with it too, and an upload's, which are its ingest's
 * statuses: "Legge il PDF", "Lo divide in passaggi", "Lo rende cercabile".
 */

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { StepEvent } from "@/api/contract";
import { Spinner } from "@/components/ui/spinner";

/** An upload's steps, after its wait in the queue: its ingest's statuses (api/system.ts). */
export type IngestStep = "parsing" | "chunking" | "indexing";

/**
 * A step as a list shows it: an answer's `StepEvent`, or an upload's. `since`,
 * when it is known, is when a step under way began, in ms since the epoch: the
 * system page opens on steps begun before it.
 */
export interface Step {
  name: StepEvent["name"] | IngestStep;
  ms: number | null;
  since?: number;
}

interface StepListProps {
  /** The steps in the order they began: one with a `null` `ms` is under way. */
  steps: readonly Step[];
  /**
   * How many excerpts the search found, from `start`; `null` until then, when
   * a finished search keeps its running words rather than claim a count.
   */
  found: number | null;
  /**
   * How many sources the answer cited, said beside what the search found;
   * `null` until the answer is whole, and when there was nothing to cite.
   */
  cited: number | null;
  /** The answer is still being worked on, so a step under way has a row. */
  live: boolean;
  /** How many passages an upload was cut into, as `found` is for a search. */
  chunks?: number | null;
}

/** A wait in the queue shorter than this has no row once it is over. */
const UNNOTICED_MS = 1000;

/** The steps that get a row. */
export function shownSteps<T extends Step>(steps: readonly T[], live: boolean): T[] {
  return steps.filter((step) =>
    step.ms === null ? live : !(step.name === "queue" && step.ms < UNNOTICED_MS),
  );
}

/** Milliseconds since `since`, or since the row appeared, refreshed every tenth of a second. */
function useElapsed(since: number | undefined): number {
  const [elapsed, setElapsed] = useState(() =>
    since === undefined ? 0 : Math.max(0, Date.now() - since),
  );
  useEffect(() => {
    const from = since ?? Date.now();
    const timer = setInterval(() => setElapsed(Math.max(0, Date.now() - from)), 100);
    return () => clearInterval(timer);
  }, [since]);
  return elapsed;
}

/** `ms` as seconds to a tenth, in the interface's language: "1,2 s". */
function Seconds({ ms }: { ms: number }) {
  const { t, i18n } = useTranslation();
  const seconds = new Intl.NumberFormat(i18n.language, {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  }).format(ms / 1000);
  return (
    <span className="pl-tight text-right text-muted tabular-nums">
      {t("steps.seconds", { seconds })}
    </span>
  );
}

/** Each row on the list's three columns, so the seconds line up under one another. */
const ROW = "col-span-3 grid grid-cols-subgrid items-center";

/**
 * The step under way: its time is this page's own, since the server sends it
 * only at the end, counted from when it began where that is known.
 */
function Running({ name, since }: Pick<Step, "name" | "since">) {
  const { t } = useTranslation();
  const elapsed = useElapsed(since);
  return (
    <li className={ROW}>
      <Spinner className="text-accent" />
      <span className="shimmer">{t(`steps.running.${name}`)}</span>
      <Seconds ms={elapsed} />
    </li>
  );
}

function Done({
  name,
  ms,
  found,
  cited,
  chunks = null,
}: { name: Step["name"]; ms: number } & Pick<StepListProps, "found" | "cited" | "chunks">) {
  const { t } = useTranslation();
  // A step that counts what it found keeps its running words until the count arrives.
  const counted = name === "retrieve" ? found : name === "chunking" ? chunks : undefined;
  let words: string;
  if (counted === undefined) words = t(`steps.done.${name}`);
  else if (counted === null) words = t(`steps.running.${name}`);
  else words = t(`steps.done.${name}`, { count: counted });
  return (
    <li className={ROW}>
      <span className="grid size-icon place-items-center rounded-full bg-ink text-canvas">
        <Check aria-hidden className="size-2.5" />
      </span>
      <span>
        {words}
        {name === "retrieve" && cited !== null && (
          <span className="text-muted">{` · ${t("process.cited", { count: cited })}`}</span>
        )}
      </span>
      <Seconds ms={ms} />
    </li>
  );
}

export function StepList({ steps, found, cited, live, chunks }: StepListProps) {
  const rows = shownSteps(steps, live);
  if (rows.length === 0) return null;
  return (
    <ol className="grid w-fit grid-cols-[var(--spacing-icon)_auto_auto] gap-x-tight gap-y-hair">
      {rows.map((step) =>
        step.ms === null ? (
          // Keyed by name, so the next step under way counts from zero.
          <Running key={step.name} name={step.name} since={step.since} />
        ) : (
          <Done
            key={step.name}
            name={step.name}
            ms={step.ms}
            found={found}
            cited={cited}
            chunks={chunks}
          />
        ),
      )}
    </ol>
  );
}
