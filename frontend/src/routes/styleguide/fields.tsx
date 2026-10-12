/**
 * The catalogue's fields: the boxed ones a form in a page or a dialog uses,
 * and the underlined ones of the sign-in card.
 */

import { useState } from "react";

import { LineField } from "@/components/LineField";
import { PasswordField } from "@/components/PasswordField";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Specimen, type Theme } from "./Specimen";

/** A password field holds its value, so its specimen does too. */
function PasswordSpecimen({ id }: { id: string }) {
  const [value, setValue] = useState("segreto123");
  return (
    <PasswordField
      id={id}
      label="Password"
      autoComplete="current-password"
      value={value}
      onChange={setValue}
    />
  );
}

export function Fields({ theme }: { theme: Theme }) {
  return (
    <>
      <Specimen name="Input" note="One control height, shared with the default button.">
        <Input placeholder="Input" />
      </Specimen>

      <Specimen name="Textarea" note="Starts at the field height and grows downward only.">
        <Textarea placeholder="Textarea" />
      </Specimen>

      <Specimen
        name="LineField"
        note="The sign-in card's field: an underline, the label floating up on focus or once filled, and an accent line growing from the left while it has the focus."
      >
        <LineField
          id={`styleguide-${theme}-username`}
          label="Nome utente"
          className="w-full max-w-xs"
        />
      </Specimen>

      <Specimen
        name="PasswordField"
        note="A LineField for a password, with an eye whose name never changes and whose state is aria-pressed."
      >
        <div className="w-full max-w-xs">
          <PasswordSpecimen id={`styleguide-${theme}-password`} />
        </div>
      </Specimen>
    </>
  );
}
