/** `/staff/programmes`: the degree programmes the caller may view. */

import { useTranslation } from "react-i18next";
import { Link } from "react-router-dom";

import { listProgrammes } from "@/api/catalog";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useLoad } from "@/features/staff/context";
import { LoadFailure } from "@/features/staff/NotFound";

export default function ProgrammesPage() {
  const { t } = useTranslation();
  const programmes = useLoad(listProgrammes);

  return (
    <section className="flex flex-col gap-snug">
      <h1 className="font-semibold text-ink text-title">{t("staff.programmes.title")}</h1>
      {programmes.error !== null && <LoadFailure error={programmes.error} />}
      {programmes.data?.length === 0 && (
        <p className="text-body text-muted">{t("staff.programmes.empty")}</p>
      )}
      {programmes.data !== null && programmes.data.length > 0 && (
        <Table>
          <TableCaption>{t("staff.programmes.caption")}</TableCaption>
          <TableHeader>
            <TableRow>
              <TableHead>{t("staff.programmes.code")}</TableHead>
              <TableHead>{t("staff.programmes.name")}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {programmes.data.map((programme) => (
              <TableRow key={programme.code}>
                <TableCell className="font-mono">
                  <Link to={`/staff/programmes/${programme.code}`} className="hover:underline">
                    {programme.code}
                  </Link>
                </TableCell>
                <TableCell>{programme.name}</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </section>
  );
}
