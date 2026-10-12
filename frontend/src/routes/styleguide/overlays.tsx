/**
 * The catalogue's overlays: what opens over the page from a trigger. Each
 * opens in a portal at the end of the document, so it follows the page's
 * theme rather than its panel's; the drawer and the two dialogs are open
 * below both panels (routes/StyleguidePage.tsx).
 */

import {
  BookOpen,
  CircleHelp,
  Copy,
  ExternalLink,
  Globe,
  LogOut,
  SlidersHorizontal,
  UserRound,
} from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Chip } from "@/components/ui/chip";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { HoverCard } from "@/components/ui/hover-card";
import { LocaleSwitch } from "@/components/ui/locale-switch";
import { Toaster } from "@/components/ui/sonner";
import { Specimen } from "./Specimen";

/** The menu's language choice holds its value, so its specimen does too. */
function MenuSpecimen() {
  const [language, setLanguage] = useState("it");
  return (
    <DropdownMenu
      ariaLabel="Account"
      trigger={<Avatar name="junliang" />}
      head={<p className="truncate font-semibold text-body text-ink">junliang</p>}
      sections={[
        {
          key: "settings",
          items: [
            {
              key: "language",
              icon: Globe,
              label: "Lingua",
              value: language,
              options: [
                { value: "it", label: "Italiano", lang: "it" },
                { value: "en", label: "English", lang: "en" },
                { value: "zh-hans", label: "简体中文", lang: "zh-hans" },
              ],
              onValueChange: setLanguage,
            },
            {
              key: "settings",
              icon: SlidersHorizontal,
              label: "Impostazioni…",
              onSelect: () => {},
              shortcut: { keys: "Control+Comma", label: "Ctrl ," },
            },
          ],
        },
        {
          key: "help",
          label: "Supporto",
          items: [
            {
              key: "help",
              icon: CircleHelp,
              label: "Aiuto e scorciatoie",
              onSelect: () => {},
              shortcut: { keys: "Shift+?", label: "?" },
            },
          ],
        },
        {
          key: "session",
          items: [
            { key: "account", icon: UserRound, label: "Account", onSelect: () => {} },
            { key: "logout", icon: LogOut, label: "Esci", onSelect: () => {} },
          ],
        },
      ]}
    />
  );
}

export function Overlays() {
  return (
    <>
      <Specimen
        name="LocaleSwitch"
        note="A globe and the language in use, opening on each language named in itself. Rendered twice on screen — account dialog and login frame — and written once. The chosen language gets a check mark, never the accent."
      >
        <LocaleSwitch
          locales={["it", "en", "zh-hans"]}
          value="it"
          label="Lingua"
          hint="Le risposte seguono la lingua della domanda, non quella dell'interfaccia."
          onChange={() => {}}
        />
      </Specimen>

      <Specimen
        name="DropdownMenu"
        note="The menu behind the account: a head, sections with an optional label, 32 px items with their key at the right, rules from edge to edge, and a choice as a submenu showing its current value. It opens in a portal."
      >
        <MenuSpecimen />
      </Specimen>

      <Specimen
        name="HoverCard"
        note="Previews where a link goes: it opens for a pointer resting on the link for 200 ms and for keyboard focus, and closes on Escape or when the pointer leaves. A tinted head says what the source is, the body what it says, soft buttons what to do with it. Radix keeps it out of the tab order, so what it holds is reachable elsewhere too, and a click follows the link."
      >
        <HoverCard
          sections={[
            {
              key: "slide",
              head: (
                <>
                  <BookOpen aria-hidden className="size-icon text-accent" />
                  <span className="flex-1">Basi di dati</span>
                  <Chip size="sm">IT</Chip>
                </>
              ),
              body: (
                <>
                  <span className="font-medium">Iscrizioni</span>
                  <span className="line-clamp-2 text-muted">
                    Le iscrizioni al primo anno si chiudono il 30 settembre, salvo proroghe.
                  </span>
                </>
              ),
              actions: (
                <>
                  <Button variant="soft" size="sm">
                    <ExternalLink aria-hidden className="size-icon" />
                    Apri la slide a pagina 12
                  </Button>
                  <Button variant="ghost" size="icon-sm" aria-label="Copia la citazione">
                    <Copy aria-hidden className="size-icon" />
                  </Button>
                </>
              ),
            },
          ]}
        >
          <a
            href="https://www.unifi.it/"
            target="_blank"
            rel="noopener noreferrer"
            className="self-start rounded-full bg-mark px-tight font-medium text-caption text-muted transition-colors hover:bg-ink hover:text-canvas data-[state=open]:bg-ink data-[state=open]:text-canvas"
          >
            unifi.it
          </a>
        </HoverCard>
      </Specimen>

      <Specimen
        name="Toaster"
        note="Where a finished action says so, in the corner, read out politely and gone after a few seconds: the ink ground, an icon, the result over its object. A failure has the warning's disc and a way to try again. The buttons raise one of each."
      >
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            toast.success("Docente assegnato", { description: "mrossi · B028451 · 2025-2026" })
          }
        >
          Mostra un avviso
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() =>
            toast.error("La pagina non si è caricata.", {
              action: { label: "Riprova", onClick: () => {} },
            })
          }
        >
          Mostra un errore
        </Button>
        <Toaster />
      </Specimen>

      <Specimen
        name="Sheet"
        note="A drawer over the whole page, so it cannot be shown inside this panel. It is open in the specimen below, outside the two themes."
      />

      <Specimen
        name="Dialog"
        note="A window in the middle of the page, 440 px wide: a head with the action's icon in a disc (DialogDisc), its title and its object; a body; a tinted foot for the buttons (DialogFooter). A form dialog's primary button shows Enter. Portalled like the drawer, and shown below for the same reason."
      />

      <Specimen
        name="AlertDialog"
        note="A question before an action that destroys or replaces something, drawn as Dialog is; the disc and the confirming button take the warning's tint only when something is destroyed, and the button then repeats the disc's icon. Focus opens on Cancel; it closes only once the action is done. Portalled, and shown below."
      />
    </>
  );
}
