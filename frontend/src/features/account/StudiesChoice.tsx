/**
 * The account page's section on what the account studies (routes/AccountPage.tsx):
 * each choice is written as it is made, as the language in the account menu
 * is, and the account the server answers with is the one shown after. A
 * refused choice is said under it and the choice goes back to the account's.
 */

import { useState } from "react";

import { listProgrammes, type Studies } from "@/api/account";
import { useSession } from "@/auth/useSession";
import { useFormRefusal } from "@/components/FormRefusal";
import { useFailure, useLoad } from "@/features/staff/context";
import type { ErrorText } from "@/lib/errorText";
import { STUDIES_FIELDS, StudiesFields } from "./StudiesFields";

export function StudiesChoice({ studies }: { studies: Studies }) {
  const { chooseStudies } = useSession();
  const fail = useFailure();
  const programmes = useLoad(listProgrammes);
  // What was chosen, shown while it is written; the account's once it is.
  const [chosen, setChosen] = useState<Studies | null>(null);
  const [failure, setFailure] = useState<ErrorText | null>(null);
  const refusal = useFormRefusal(failure, STUDIES_FIELDS);

  const choose = async (next: Studies) => {
    setChosen(next);
    setFailure(null);
    try {
      await chooseStudies(next);
    } catch (error) {
      setFailure(fail(error, { shownFields: STUDIES_FIELDS }));
    } finally {
      setChosen(null);
    }
  };

  return (
    <div className="flex max-w-md flex-col gap-room">
      <StudiesFields
        programmes={programmes.data}
        value={chosen ?? studies}
        onChange={(next) => void choose(next)}
        failure={failure}
      />
      {refusal.alert}
    </div>
  );
}
