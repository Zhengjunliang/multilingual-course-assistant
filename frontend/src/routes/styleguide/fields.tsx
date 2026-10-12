/**
 * The catalogue's fields: the boxed ones a form in a page or a dialog uses,
 * and the underlined ones of the sign-in card.
 */

import { Monitor, Moon, Sun, UserRound } from "lucide-react";
import { useState } from "react";

import { LineField } from "@/components/LineField";
import { PasswordField } from "@/components/PasswordField";
import { Field, FieldError, SearchField } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Tabs } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup } from "@/components/ui/toggle-group";
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

/** A toggle group holds its choice, so its specimens do too. */
function ToggleSpecimens() {
  const [mode, setMode] = useState<"system" | "light" | "dark">("light");
  const [year, setYear] = useState("all");
  return (
    <>
      <ToggleGroup
        label="Aspetto"
        value={mode}
        onValueChange={setMode}
        options={[
          { value: "system", label: "Di sistema", icon: Monitor },
          { value: "light", label: "Chiaro", icon: Sun },
          { value: "dark", label: "Scuro", icon: Moon },
        ]}
      />
      <ToggleGroup
        label="Anno"
        value={year}
        onValueChange={setYear}
        options={[
          { value: "all", label: "Tutti", count: 8 },
          { value: "1", label: "1° anno", count: 3 },
          { value: "2", label: "2° anno", count: 3 },
          { value: "3", label: "3° anno", count: 2 },
        ]}
      />
    </>
  );
}

export function Fields({ theme }: { theme: Theme }) {
  return (
    <>
      <Specimen
        name="ToggleGroup"
        note="One of a few options, chosen in place: one tab stop, the arrows between the options, each a radio. The chosen one is raised out of a tinted track in ink, never in the accent, since it is a setting that is true; an option may carry a count."
      >
        <ToggleSpecimens />
      </Specimen>

      <Specimen
        name="Tabs"
        note="Views of one page, one at a time, underlined: the shown tab in ink over a 2 px rule in the accent, its count in the accent. The arrows move between tabs; each tab is tied to its panel."
      >
        <Tabs
          label="Corso di laurea"
          defaultValue="plan"
          className="w-full"
          tabs={[
            {
              value: "plan",
              label: "Insegnamenti",
              count: 8,
              content: <p className="text-body text-muted">Otto insegnamenti.</p>,
            },
            {
              value: "office",
              label: "Segreteria didattica",
              count: 2,
              content: <p className="text-body text-muted">Due persone.</p>,
            },
            {
              value: "editions",
              label: "Edizioni",
              content: <p className="text-body text-muted">Nessuna edizione.</p>,
            },
          ]}
        />
      </Specimen>

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
