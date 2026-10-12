/**
 * The catalogue's fields: the boxed ones a form in a page or a dialog uses,
 * and the underlined ones of the sign-in card.
 */

import { UserRound } from "lucide-react";
import { useState } from "react";

import { LineField } from "@/components/LineField";
import { PasswordField } from "@/components/PasswordField";
import { Field, FieldError, SearchField } from "@/components/ui/field";
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

/** A field with a counter holds its value, so its specimen does too. */
function CounterSpecimen({ id }: { id: string }) {
  const [value, setValue] = useState("");
  return (
    <Field
      id={id}
      label="Messaggio"
      counter
      maxLength={120}
      value={value}
      onChange={(event) => setValue(event.target.value)}
    />
  );
}

export function Fields({ theme }: { theme: Theme }) {
  return (
    <>
      <Specimen
        name="Field"
        note="A form's field in a page or a dialog: its label, the box with an icon at its start, then its refusal, its hint and a count of what is left. The hint and the refusal describe the input; the focus is the box's accent edge and a 3 px ring of --selected."
      >
        <div className="flex w-full max-w-sm flex-col gap-gutter">
          <Field
            id={`styleguide-${theme}-field`}
            label="Nome utente"
            icon={UserRound}
            placeholder="es. luca.verdi"
            hint="Il nome con cui la persona accede; l'account deve già esistere."
          />
          <Field
            id={`styleguide-${theme}-refused`}
            label="Nome utente"
            icon={UserRound}
            defaultValue="luca.verdy"
            error="Nessun account con questo nome utente: controlla l'ortografia."
          />
          <CounterSpecimen id={`styleguide-${theme}-counter`} />
        </div>
      </Specimen>

      <Specimen
        name="SearchField"
        note="A filter's box: a magnifier, a name read out in place of a label, and the key that reaches it."
      >
        <SearchField
          label="Cerca"
          placeholder="Cerca"
          shortcut={{ keys: "Control+K", label: "Ctrl K" }}
          className="w-full max-w-xs"
        />
      </Specimen>

      <Specimen
        name="FieldError"
        note="What was refused, after an icon, under the field it is about; shared by Field and the sign-in card's fields."
      >
        <FieldError>Nome utente o password non corretti.</FieldError>
      </Specimen>

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
