/**
 * The catalogue's overlays: what opens over the page from a trigger. Each
 * opens in a portal at the end of the document, so it follows the page's
 * theme rather than its panel's; the drawer and the two dialogs are open
 * below both panels (routes/StyleguidePage.tsx).
 */

import { LogOut, UserRound } from "lucide-react";
import { toast } from "sonner";

import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { DropdownMenu } from "@/components/ui/dropdown-menu";
import { HoverCard } from "@/components/ui/hover-card";
import { LocaleSwitch } from "@/components/ui/locale-switch";
import { Toaster } from "@/components/ui/sonner";
import { Specimen } from "./Specimen";

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
          onChange={() => {}}
        />
      </Specimen>

      <Specimen name="DropdownMenu" note="The menu behind the avatar; it opens in a portal.">
        <DropdownMenu
          ariaLabel="Account"
          trigger={<Avatar name="junliang" />}
          label="junliang"
          caption="Studente"
          entries={[
            { key: "account", icon: UserRound, label: "Account", onSelect: () => {} },
            { key: "logout", icon: LogOut, label: "Esci", onSelect: () => {} },
          ]}
        />
      </Specimen>

      <Specimen
        name="HoverCard"
        note="Previews where a link goes: it opens for a pointer resting on the link for 200 ms and for keyboard focus, and closes on Escape or when the pointer leaves. Radix keeps it out of the tab order, so what it holds is reachable elsewhere too, and a click follows the link."
      >
        <HoverCard
          content={
            <>
              <span className="text-caption text-muted">unifi.it</span>
              <span className="font-medium">Iscrizioni</span>
              <span className="line-clamp-2 text-muted">
                Le iscrizioni al primo anno si chiudono il 30 settembre, salvo proroghe.
              </span>
            </>
          }
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
        note="Where a finished action says so, in the corner, read out politely and gone after a few seconds; the button raises one."
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
        <Toaster />
      </Specimen>

      <Specimen
        name="Sheet"
        note="A drawer over the whole page, so it cannot be shown inside this panel. It is open in the specimen below, outside the two themes."
      />

      <Specimen
        name="Dialog"
        note="A window in the middle of the page. Portalled like the drawer, and shown below for the same reason."
      />

      <Specimen
        name="AlertDialog"
        note="A question before an action that destroys or replaces something. Focus opens on Cancel; it closes only once the action is done. Portalled, and shown below."
      />
    </>
  );
}
