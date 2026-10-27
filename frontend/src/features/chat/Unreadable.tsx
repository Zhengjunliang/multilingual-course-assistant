/**
 * What a conversation's address shows when the conversation cannot be read.
 *
 * Deleted, or never the reader's, it is "not available": the server answers
 * both with the same 404, so as not to tell a reader that someone else's
 * exists (docs/api.md). Any other failure says why, in the interface's words,
 * with the code and the request id under it when the reader can only report
 * it (lib/errorText.ts): a dropped connection is not a conversation gone.
 */

import { useTranslation } from "react-i18next";

import { ApiError } from "@/api/http";
import { describeError } from "@/lib/errorText";

export function Unreadable({ error }: { error: unknown }) {
  const { t } = useTranslation();
  if (error instanceof ApiError && error.code === "NOT_FOUND") {
    return <p className="text-body text-muted">{t("sidebar.unreadable")}</p>;
  }
  const { sentence, reference } = describeError(error);
  return (
    <div>
      <p className="text-body text-muted">{t(sentence.key, sentence.values)}</p>
      {reference !== null && (
        <p className="text-caption text-muted">{t(reference.key, reference.values)}</p>
      )}
    </div>
  );
}
