/**
 * The breadcrumb above a staff page, as the prototype builds it.
 *
 * Its root is the reader's Gestione item (landing.ts): "Corsi di laurea", a
 * link to the list, for whoever has the list; "Corso di laurea", plain text,
 * for whoever has one programme and so no page above it. The page itself is
 * the last crumb, which `Breadcrumb` marks as the current page.
 */

import type { TFunction } from "i18next";

import type { ProgrammeName } from "@/api/catalog";
import type { Crumb } from "@/components/ui/breadcrumb";
import type { ManagementKey } from "./landing";

export type StaffPage =
  | { kind: "programmes" }
  | { kind: "programme"; programme: ProgrammeName }
  | { kind: "notFound" };

export function programmeLabel(programme: ProgrammeName): string {
  return `${programme.code} · ${programme.name}`;
}

export function crumbs(page: StaffPage, root: ManagementKey | null, t: TFunction): Crumb[] {
  switch (page.kind) {
    case "programmes":
      return [{ label: t("staff.programmes.title") }];
    case "programme": {
      const top =
        root === "programmes"
          ? { label: t("staff.nav.programmes"), to: "/staff/programmes" }
          : { label: t("staff.nav.programme") };
      return [top, { label: programmeLabel(page.programme) }];
    }
    case "notFound":
      return [{ label: t("staff.refusal.notFound") }];
  }
}
