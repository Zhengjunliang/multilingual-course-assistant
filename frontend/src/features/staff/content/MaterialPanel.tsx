/**
 * An edition's material, a tab of its page for whoever holds
 * `edition.manage_materials`: a panel whose head names it, counts it and
 * holds «Carica PDF», over a strip that takes PDFs dropped anywhere on the
 * panel and says what is being sent, what was not sent and why, and a table
 * with one row per file, its name over who uploaded it and when, and the
 * state of its ingest: a step with a spinner, ready, or failed and why. A
 * file named as a material the edition holds is sent only once the reader
 * confirms. What is sent when, and how the list keeps up, is materials.ts.
 */

import { CircleAlert, FileUp, Replace } from "lucide-react";
import { type DragEvent, useId, useRef, useState } from "react";
import { useTranslation } from "react-i18next";

import type { CourseMaterial } from "@/api/catalog";
import { AlertDialog } from "@/components/ui/alert-dialog";
import { Banner } from "@/components/ui/banner";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { Count } from "@/components/ui/count";
import { Spinner } from "@/components/ui/spinner";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { cn } from "@/lib/utils";
import type { Loaded } from "../context";
import { PartFailure } from "../Refusal";
import { usePolling, useUploads } from "./materials";

interface MaterialPanelProps {
  edition: number;
  /** The list, as the page read it: the page's tab counts its files. */
  materials: Loaded<CourseMaterial[]>;
  /** Reads the page again, after an upload found the edition gone. */
  reloadPage: () => Promise<boolean>;
}

export function MaterialPanel({ edition, materials, reloadPage }: MaterialPanelProps) {
  const { t, i18n } = useTranslation();
  const headingId = useId();
  const picker = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  const { sending, unsent, replacing, take, replace, keep } = useUploads(
    edition,
    materials,
    reloadPage,
  );
  usePolling(materials);
  const { data: rows, reload } = materials;

  const drop = (event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    setOver(false);
    take([...event.dataTransfer.files]);
  };

  const dateTime = new Intl.DateTimeFormat(i18n.language, {
    dateStyle: "medium",
    timeStyle: "short",
  });
  return (
    <section
      aria-labelledby={headingId}
      onDragOver={(event) => {
        if (!event.dataTransfer.types.includes("Files")) return;
        event.preventDefault();
        setOver(true);
      }}
      onDragLeave={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setOver(false);
      }}
      onDrop={drop}
      className="flex flex-col gap-snug sm:gap-0 sm:overflow-hidden sm:rounded-card sm:border sm:border-line sm:bg-surface sm:shadow-raised"
    >
      <div className="flex flex-wrap items-center gap-snug sm:border-hairline sm:border-b sm:bg-tint sm:px-snug sm:py-tight">
        <h2 id={headingId} className="font-semibold text-ink text-title">
          {t("staff.materials.title")}
        </h2>
        {rows !== null && <Count value={rows.length} />}
        <span className="flex-1" />
        <input
          ref={picker}
          type="file"
          multiple
          accept="application/pdf,.pdf"
          hidden
          onChange={(event) => {
            take([...(event.currentTarget.files ?? [])]);
            event.currentTarget.value = "";
          }}
        />
        <Button type="button" variant="outline" onClick={() => picker.current?.click()}>
          <FileUp aria-hidden className="size-icon" />
          {t("staff.materials.add")}
        </Button>
      </div>
      <div
        className={cn(
          "flex items-center gap-snug rounded-control border border-dashed px-snug py-tight text-caption text-muted transition-colors duration-fast ease-standard sm:m-snug",
          over ? "border-accent bg-accent-soft text-accent" : "border-line",
        )}
      >
        {sending > 0 ? (
          <Spinner className="text-accent" />
        ) : (
          <FileUp aria-hidden className="size-icon" />
        )}
        <p role="status">
          {sending > 0
            ? t("staff.materials.sending", { count: sending })
            : t("staff.materials.drop")}
        </p>
      </div>
      {unsent.length > 0 && (
        <div role="alert" className="flex flex-col gap-tight sm:px-snug sm:pb-snug">
          <Banner tone="warn" icon={CircleAlert} heading={t("staff.materials.unsent")} />
          <ul className="flex flex-col gap-hair text-body">
            {unsent.map(({ id, name, sentence, reference }) => (
              <li key={id}>
                <span className="font-semibold text-ink">{name}</span>
                {" · "}
                <span className="text-warn-ink">{t(sentence.key, sentence.values)}</span>
                {reference !== null && (
                  <span className="block text-caption text-muted">
                    {t(reference.key, reference.values)}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {materials.error !== null ? (
        <div className="sm:p-snug">
          <PartFailure onRetry={() => void reload()} />
        </div>
      ) : rows === null ? null : rows.length === 0 ? (
        <p className="px-snug py-gutter text-body text-muted max-sm:rounded-card max-sm:border max-sm:border-line max-sm:bg-surface">
          {t("staff.materials.empty")}
        </p>
      ) : (
        // The panel is the frame, its head above the table's.
        <Table frameClassName="rounded-none border-0">
          <TableHeader className="[&>tr>th:first-child]:rounded-none [&>tr>th:last-child]:rounded-none">
            <TableRow>
              <TableHead>{t("staff.materials.file")}</TableHead>
              <TableHead>{t("staff.materials.state")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((material) => (
              <TableRow key={material.id}>
                <TableCell>
                  <span className="block font-semibold text-ink">{material.source_file}</span>
                  <span className="mt-hair block text-caption text-muted">
                    {material.uploaded_by === null
                      ? t("staff.materials.imported")
                      : t("staff.materials.uploadedBy", { name: material.uploaded_by })}
                    {" · "}
                    <span className="tabular-nums">
                      {dateTime.format(new Date(material.created_at))}
                    </span>
                  </span>
                </TableCell>
                <TableCell label={t("staff.materials.state")}>
                  <State material={material} />
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
      <AlertDialog
        open={replacing.length > 0}
        onOpenChange={(next) => {
          if (!next) keep();
        }}
        heading={t("staff.materials.replaceTitle")}
        icon={Replace}
        description={
          <>
            {t("staff.materials.replaceBody")}{" "}
            {replacing.map((file) => (
              <Chip key={file.name} className="mr-hair">
                {file.name}
              </Chip>
            ))}
          </>
        }
        cancelLabel={t("staff.cancel")}
        confirmLabel={t("staff.materials.replace")}
        onConfirm={async () => {
          replace();
          return true;
        }}
      />
    </section>
  );
}

/** Where a material's ingest is: a step with a spinner, ready, or failed and why. */
function State({ material }: { material: CourseMaterial }) {
  const { t } = useTranslation();
  const label = t(`staff.materials.status.${material.status}`);
  if (material.status === "ready") return <Chip tone="accent">{label}</Chip>;
  if (material.status === "failed")
    return (
      <span className="flex flex-col items-start gap-hair">
        <Chip tone="warn">{label}</Chip>
        {material.failure !== "" && (
          <span className="text-caption text-muted">
            {t(`staff.materials.failure.${material.failure}`)}
          </span>
        )}
      </span>
    );
  return (
    <span className="inline-flex items-center gap-tight whitespace-nowrap text-body text-ink">
      <Spinner className="text-accent" />
      {label}
    </span>
  );
}
