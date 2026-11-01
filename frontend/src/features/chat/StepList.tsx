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
 * its timeline's once it has been.
 */

import { Check } from "lucide-react";
import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";

import type { StepEvent } from "@/api/contract";
import { Spinner } from "@/components/ui/spinner";

interface StepListProps {
  /** The steps in the order they began: one with a `null` `ms` is under way. */
  steps: readonly StepEvent[];
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
}

/** A wait in the queue shorter than this has no row once it is over. */
const UNNOTICED_MS = 1000;

/** The steps that get a row. */
export function shownSteps(steps: readonly StepEvent[], live: boolean): StepEvent[] {
  return steps.filter((step) =>
    step.ms === null ? live : !(step.name === "queue" && step.ms < UNNOTICED_MS),
  );
}

/** Milliseconds since the row appeared, refreshed every tenth of a second. */
function useElapsed(): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const from = Date.now();
    const timer = setInterval(() => setElapsed(Date.now() - from), 100);
    return () => clearInterval(timer);
  }, []);
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

/** The step under way: its time is this page's own, since the server sends it only at the end. */
function Running({ name }: { name: StepEvent["name"] }) {
  const { t } = useTranslation();
  const elapsed = useElapsed();
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
}: { name: StepEvent["name"]; ms: number } & Pick<StepListProps, "found" | "cited">) {
  const { t } = useTranslation();
  let words: string;
  if (name !== "retrieve") words = t(`steps.done.${name}`);
  else if (found === null) words = t("steps.running.retrieve");
  else words = t("steps.done.retrieve", { count: found });
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

export function StepList({ steps, found, cited, live }: StepListProps) {
  const rows = shownSteps(steps, live);
  if (rows.length === 0) return null;
  return (
    <ol className="grid w-fit grid-cols-[var(--spacing-icon)_auto_auto] gap-x-tight gap-y-hair">
      {rows.map((step) =>
        step.ms === null ? (
          // Keyed by name, so the next step under way counts from zero.
          <Running key={step.name} name={step.name} />
        ) : (
          <Done key={step.name} name={step.name} ms={step.ms} found={found} cited={cited} />
        ),
      )}
    </ol>
  );
}
