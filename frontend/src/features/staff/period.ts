/**
 * An edition's teaching period, the Cineca catalogue's Periodo didattico, in
 * the interface's words, such as "1st semester".
 */

import type { TFunction } from "i18next";

import type { TeachingPeriod } from "@/api/catalog";

/** Each period's name; a period added to the contract fails `tsc` here. */
const PERIOD_NAME: Record<TeachingPeriod, `staff.period.${TeachingPeriod}`> = {
  first_semester: "staff.period.first_semester",
  second_semester: "staff.period.second_semester",
};

/** The period's name, or null when nobody entered it. */
export function periodName(period: TeachingPeriod | "", t: TFunction): string | null {
  return period === "" ? null : t(PERIOD_NAME[period]);
}
