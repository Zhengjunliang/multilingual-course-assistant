// @vitest-environment jsdom

/**
 * The two staff dialogs against each answer the server can give: the
 * write done, a refusal of the field, a missing permission, the object gone.
 * The network is faked at `fetch` with each refusal in both bodies the server
 * may send, the staff endpoints' envelope (config/exceptions.py) and the coded
 * `{"error": ...}`, so the codes travel through `api/http.ts` as they would in
 * the application.
 */

import { act, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/api/account";
import type { MemberScope } from "@/api/catalog";
import { SessionContext } from "@/auth/SessionProvider";
import { Chip } from "@/components/ui/chip";
import { Toaster } from "@/components/ui/sonner";
import { mount } from "@/test/mount";
import { AssignDialog } from "./AssignDialog";
import { RevokeDialog } from "./RevokeDialog";

const READER: Account = {
  id: 1,
  username: "demo-secretariat",
  locale: "it",
  is_superuser: false,
  roles: [],
};
const EDITION: MemberScope = { kind: "edition", id: 5 };
const B047: MemberScope = { kind: "programme", code: "B047" };

/** What the server answers the write. */
let answer: () => Response = () => new Response(null, { status: 204 });
/** How many writes reached the server. */
let sent = 0;

function json(body: unknown, status: number): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const REFUSED = {
  noSuchUser: () => json({ username: [{ message: "No such user.", code: "no_such_user" }] }, 400),
  alreadyHeld: () => json({ username: [{ message: "Already held.", code: "already_held" }] }, 400),
  forbidden: () => json({ detail: { message: "No permission.", code: "permission_denied" } }, 403),
  gone: () => json({ detail: { message: "Not found.", code: "not_found" } }, 404),
  broken: () => json({ detail: { message: "Server error.", code: "error" } }, 500),
};

function coded(status: number, code: string, fields: unknown[] = []): Response {
  const error = { code, message: "Server's words.", data: {}, fields, request_id: "0".repeat(32) };
  return json({ error }, status);
}

/** The same refusals in the coded body (#186). */
const CODED = {
  noSuchUser: () =>
    coded(400, "INVALID_ARGUMENT", [{ field: "username", reason: "NO_SUCH_USER", data: {} }]),
  alreadyHeld: () => coded(409, "ROLE_ALREADY_HELD"),
  forbidden: () => coded(403, "PERMISSION_DENIED"),
  gone: () => coded(404, "NOT_FOUND"),
  broken: () => coded(500, "INTERNAL"),
};

let changed = 0;
let closed = 0;
/** Whether the page reads again after the write, as `useLoad().reload` resolves. */
let readable = true;
const onChanged = async () => {
  changed += 1;
  return readable;
};
const onClose = () => {
  closed += 1;
};

function open(dialog: ReactElement) {
  return mount(
    <SessionContext
      value={{
        account: READER,
        logIn: async () => {},
        register: async () => {},
        logOut: async () => {},
        chooseLocale: async () => {},
        forget: () => {},
        recheck: async () => {},
      }}
    >
      {dialog}
      <Toaster />
    </SessionContext>,
  );
}

async function settle() {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** The dialog, portalled out of the container. */
const dialog = () => document.body.querySelector('[role="dialog"], [role="alertdialog"]');
const body = () => document.body.textContent ?? "";

/** The button a screen reader names `label`: its text without what is hidden from it, such as a key's cap. */
function button(label: string) {
  const name = (candidate: HTMLButtonElement) => {
    const copy = candidate.cloneNode(true) as HTMLElement;
    for (const hidden of copy.querySelectorAll("[aria-hidden=true]")) hidden.remove();
    return copy.textContent?.trim();
  };
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => name(candidate) === label,
  );
}

function type(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    setter?.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(() => {
  changed = 0;
  closed = 0;
  readable = true;
  sent = 0;
  vi.stubGlobal("fetch", async () => {
    sent += 1;
    return answer();
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

/** The label of the focused button, or what else holds focus. */
function focused(): string | null {
  const active = document.activeElement;
  if (active instanceof HTMLButtonElement) return active.textContent?.trim() ?? null;
  return active?.tagName.toLowerCase() ?? null;
}

describe("assigning a member", () => {
  async function assign(
    scope: MemberScope,
    refusal: (() => Response) | null,
    press: "button" | "enter" = "button",
    name = "mrossi",
  ) {
    answer = refusal ?? (() => json({ id: 7, username: "mrossi", name: "Mario Rossi" }, 201));
    const { unmount } = open(
      <AssignDialog
        scope={scope}
        object="PPM · 2025-2026"
        description="PPM · 2025-2026"
        onClose={onClose}
        onChanged={onChanged}
      />,
    );
    const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input');
    const focusedOnOpen = document.activeElement === input;
    if (input && name !== "") type(input, name);
    act(() => {
      if (press === "enter") {
        // What Enter in the field does: submit the form it is in.
        input?.form?.requestSubmit();
      } else {
        // A pointer press moves focus to the button, which jsdom's click does not.
        button("Assegna")?.focus();
        button("Assegna")?.click();
      }
    });
    await settle();
    const seen = {
      focusedOnOpen,
      closed,
      changed,
      invalid: input?.getAttribute("aria-invalid") ?? null,
      focusedAfter: document.activeElement === input,
      submitOff: button("Assegna")?.disabled ?? null,
      sent,
      text: body(),
    };
    unmount();
    return seen;
  }

  it.each([
    [EDITION, "button" as const, "Docente assegnato"],
    [B047, "enter" as const, "Segreteria assegnata"],
  ])("assigns, reads the page again, closes and says so", async (scope, press, title) => {
    const seen = await assign(scope, null, press);

    expect([seen.focusedOnOpen, seen.closed, seen.changed]).toEqual([true, 1, 1]);
    expect(seen.text).toContain(title);
    // The toast names the person as the page shows them.
    expect(seen.text).toContain("Mario Rossi · PPM · 2025-2026");
  });

  it("refuses an empty name under the field, its button on, asking the server nothing", async () => {
    const seen = await assign(EDITION, null, "button", "");

    expect([seen.closed, seen.sent, seen.submitOff, seen.invalid, seen.focusedAfter]).toEqual([
      0,
      0,
      false,
      "true",
      true,
    ]);
    expect(seen.text).toContain("Inserisci un nome utente.");
  });

  it.each([
    ["no such user", REFUSED.noSuchUser, "Nessun utente con questo nome."],
    ["no such user, coded", CODED.noSuchUser, "Nessun utente con questo nome."],
    ["one already holding the role", REFUSED.alreadyHeld, "Questo utente ha già questo ruolo qui."],
    [
      "one already holding the role, coded",
      CODED.alreadyHeld,
      "Questo utente ha già questo ruolo qui.",
    ],
  ])("refuses %s at the field, which takes focus back", async (_, refusal, sentence) => {
    const seen = await assign(EDITION, refusal);

    expect([seen.closed, seen.invalid, seen.focusedAfter]).toEqual([0, "true", true]);
    expect(seen.text).toContain(sentence);
  });

  it.each([
    ["old", REFUSED.broken],
    ["coded", CODED.broken],
  ])(
    "says a server error from the %s body in the catalogue's words, blaming no field",
    async (_, refusal) => {
      const seen = await assign(EDITION, refusal);

      expect([seen.closed, seen.invalid, seen.focusedAfter]).toEqual([0, null, true]);
      expect(seen.text).toContain("Qualcosa è andato storto. Riprova tra poco.");
      expect(seen.text).not.toMatch(/Server/);
    },
  );

  it.each([
    [
      EDITION,
      REFUSED.forbidden,
      "edition.assign_teacher",
      "Puoi vedere questa edizione, ma non assegnare docenti.",
    ],
    [
      EDITION,
      CODED.forbidden,
      "edition.assign_teacher",
      "Puoi vedere questa edizione, ma non assegnare docenti.",
    ],
    [
      B047,
      REFUSED.forbidden,
      "programme.assign_secretariat",
      "Solo l'amministratore assegna la segreteria didattica.",
    ],
  ])(
    "names the missing permission under the field and leaves the button on",
    async (scope, refusal, permission, sentence) => {
      const seen = await assign(scope, refusal);

      // Focus back in the field, since the button was off while the request ran.
      expect([seen.closed, seen.submitOff, seen.focusedAfter]).toEqual([0, false, true]);
      expect(seen.text).toContain(`Permesso mancante: ${permission}`);
      expect(seen.text).toContain(sentence);
    },
  );

  it.each([
    ["old", REFUSED.gone],
    ["coded", CODED.gone],
  ])(
    "closes and reads the page again when the %s body says the scope is gone",
    async (_, refusal) => {
      const seen = await assign(EDITION, refusal);

      expect([seen.closed, seen.changed]).toEqual([1, 1]);
    },
  );
});

describe("revoking a role", () => {
  async function revoke(refusal: (() => Response) | null) {
    answer = refusal ?? (() => new Response(null, { status: 204 }));
    const { unmount } = open(
      <RevokeDialog
        revoking={{
          scope: B047,
          username: "mrossi",
          shown: "Mario Rossi",
          object: "B047",
          sentence: (
            <>
              <Chip>Mario Rossi</Chip> non farà più parte della segreteria didattica di{" "}
              <Chip>INGEGNERIA INFORMATICA</Chip>.
            </>
          ),
        }}
        onClose={onClose}
        onChanged={onChanged}
      />,
    );
    const confirm = button("Revoca");
    const destructive = confirm?.classList.contains("text-warn-ink") ?? false;
    const chips = [...(dialog()?.querySelectorAll("p span.rounded-chip") ?? [])].map(
      (chip) => chip.textContent,
    );
    act(() => {
      confirm?.focus();
      confirm?.click();
    });
    await settle();
    const seen = {
      destructive,
      chips,
      closed,
      changed,
      confirmOff: button("Revoca")?.disabled ?? null,
      focused: focused(),
      text: body(),
    };
    unmount();
    return seen;
  }

  it("revokes in the destructive variant, reads the page again and says so", async () => {
    const seen = await revoke(null);

    expect([seen.destructive, seen.closed, seen.changed]).toEqual([true, 1, 1]);
    // Who loses what, each a chip in the question.
    expect(seen.chips).toEqual(["Mario Rossi", "INGEGNERIA INFORMATICA"]);
    expect(seen.text).toContain("Ruolo revocato");
    expect(seen.text).toContain("Mario Rossi · B047");
  });

  it.each([
    ["old", REFUSED.gone],
    ["coded", CODED.gone],
  ])(
    "takes a member gone elsewhere, as the %s body says, for the outcome asked for, and says so",
    async (_, refusal) => {
      const seen = await revoke(refusal);

      expect([seen.closed, seen.changed]).toEqual([1, 1]);
      expect(seen.text).toContain("era già stato revocato altrove");
    },
  );

  it("closes without a toast when the page is gone too", async () => {
    readable = false;
    const seen = await revoke(REFUSED.gone);

    expect([seen.closed, seen.changed]).toEqual([1, 1]);
    expect(seen.text).not.toContain("Ruolo revocato");
  });

  it.each([
    ["old", REFUSED.forbidden],
    ["coded", CODED.forbidden],
  ])(
    "names the missing permission from the %s body, leaves the button on and hands focus to Cancel",
    async (_, refusal) => {
      const seen = await revoke(refusal);

      expect([seen.closed, seen.confirmOff, seen.focused]).toEqual([0, false, "Annulla"]);
      expect(seen.text).toContain("Permesso mancante: programme.assign_secretariat");
    },
  );
});
