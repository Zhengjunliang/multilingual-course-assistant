// @vitest-environment jsdom

/**
 * The three staff dialogs against each answer the server can give: the
 * write done, a refusal of the field, a missing permission, the object gone.
 * The network is faked at `fetch` with the server's own error envelope
 * (config/exceptions.py), so the codes travel through `api/http.ts` as they
 * would in the application.
 */

import { act, type ReactElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/api/account";
import type { Edition, MemberScope } from "@/api/catalog";
import { SessionContext } from "@/auth/SessionProvider";
import { Toaster } from "@/components/ui/sonner";
import { mount } from "@/test/mount";
import { AssignDialog } from "./AssignDialog";
import { RevokeDialog } from "./RevokeDialog";
import { SetCurrentDialog } from "./SetCurrentDialog";

const READER: Account = {
  id: 1,
  username: "demo-secretariat",
  locale: "it",
  is_superuser: false,
  roles: [],
};
const EDITION: MemberScope = { kind: "edition", id: 5 };
const B047: MemberScope = { kind: "programme", code: "B047" };

function edition(id: number, year: string, current: boolean): Edition {
  return {
    id,
    course: { code: "B028451", name: "PPM", locale: "it", code_source: "moodle", entries: [] },
    academic_year: year,
    is_current: current,
    teachers: [],
    permissions: ["edition.set_current", "edition.view"],
    can_set_current: true,
  };
}

/** What the server answers the write. */
let answer: () => Response = () => new Response(null, { status: 204 });

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
  switchNeedsBoth: () =>
    json({ detail: { message: "Both ends.", code: "switch_needs_both" } }, 403),
  gone: () => json({ detail: { message: "Not found.", code: "not_found" } }, 404),
};

let changed = 0;
let closed = 0;
const onChanged = async () => {
  changed += 1;
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

function button(label: string) {
  return [...document.body.querySelectorAll<HTMLButtonElement>("button")].find(
    (candidate) => candidate.textContent?.trim() === label,
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
  vi.stubGlobal("fetch", async () => answer());
});

afterEach(() => {
  vi.unstubAllGlobals();
  document.body.innerHTML = "";
});

describe("assigning a member", () => {
  async function assign(scope: MemberScope, refusal: (() => Response) | null) {
    answer = refusal ?? (() => json({ id: 7, username: "mrossi" }, 201));
    const { unmount } = open(
      <AssignDialog
        scope={scope}
        object="PPM · 2025-2026"
        onClose={onClose}
        onChanged={onChanged}
      />,
    );
    const input = document.body.querySelector<HTMLInputElement>('[role="dialog"] input');
    const focusedOnOpen = document.activeElement === input;
    if (input) type(input, "mrossi");
    // A pointer press moves focus to the button, which jsdom's click does not.
    act(() => {
      button("Assegna")?.focus();
      button("Assegna")?.click();
    });
    await settle();
    const seen = {
      focusedOnOpen,
      closed,
      changed,
      invalid: input?.getAttribute("aria-invalid") ?? null,
      focusedAfter: document.activeElement === input,
      submitOff: button("Assegna")?.disabled ?? null,
      text: body(),
    };
    unmount();
    return seen;
  }

  it("assigns, reads the page again, closes and says so", async () => {
    const seen = await assign(EDITION, null);

    expect([seen.focusedOnOpen, seen.closed, seen.changed]).toEqual([true, 1, 1]);
    expect(seen.text).toContain("Docente assegnato");
    expect(seen.text).toContain("mrossi · PPM · 2025-2026");
  });

  it.each([
    ["no such user", REFUSED.noSuchUser, "Nessun utente con questo nome."],
    ["one already holding the role", REFUSED.alreadyHeld, "Questo utente ha già questo ruolo qui."],
  ])("refuses %s at the field, which takes focus back", async (_, refusal, sentence) => {
    const seen = await assign(EDITION, refusal);

    expect([seen.closed, seen.invalid, seen.focusedAfter]).toEqual([0, "true", true]);
    expect(seen.text).toContain(sentence);
  });

  it.each([
    [EDITION, "edition.assign_teacher", "Puoi vedere questa edizione, ma non assegnare docenti."],
    [
      B047,
      "programme.assign_secretariat",
      "Solo l'amministratore assegna la segreteria didattica.",
    ],
  ])(
    "names the missing permission and keeps the button off",
    async (scope, permission, sentence) => {
      const seen = await assign(scope, REFUSED.forbidden);

      expect([seen.closed, seen.submitOff]).toEqual([0, true]);
      expect(seen.text).toContain(`Permesso mancante: ${permission}`);
      expect(seen.text).toContain(sentence);
    },
  );

  it("closes and reads the page again when the scope is gone", async () => {
    const seen = await assign(EDITION, REFUSED.gone);

    expect([seen.closed, seen.changed]).toEqual([1, 1]);
  });
});

describe("revoking a role", () => {
  async function revoke(refusal: (() => Response) | null) {
    answer = refusal ?? (() => new Response(null, { status: 204 }));
    const { unmount } = open(
      <RevokeDialog
        revoking={{
          scope: B047,
          username: "mrossi",
          object: "B047",
          sentence: "mrossi non farà più parte…",
        }}
        onClose={onClose}
        onChanged={onChanged}
      />,
    );
    const confirm = button("Revoca");
    const destructive = confirm?.className.includes("bg-warn-ink") ?? false;
    act(() => confirm?.click());
    await settle();
    const seen = {
      destructive,
      closed,
      changed,
      confirmOff: button("Revoca")?.disabled ?? null,
      text: body(),
    };
    unmount();
    return seen;
  }

  it("revokes in the destructive variant, reads the page again and says so", async () => {
    const seen = await revoke(null);

    expect([seen.destructive, seen.closed, seen.changed]).toEqual([true, 1, 1]);
    expect(seen.text).toContain("Ruolo revocato");
    expect(seen.text).toContain("mrossi · B047");
  });

  it("takes a member gone elsewhere for the outcome asked for, and says so", async () => {
    const seen = await revoke(REFUSED.gone);

    expect([seen.closed, seen.changed]).toEqual([1, 1]);
    expect(seen.text).toContain("era già stato revocato altrove");
  });

  it("names the missing permission and keeps the button off", async () => {
    const seen = await revoke(REFUSED.forbidden);

    expect([seen.closed, seen.confirmOff]).toEqual([0, true]);
    expect(seen.text).toContain("Permesso mancante: programme.assign_secretariat");
  });
});

describe("making an edition current", () => {
  const next = edition(5, "2025-2026", false);
  const current = edition(4, "2024-2025", true);

  async function switching(replaced: Edition | null, refusal: (() => Response) | null) {
    answer = refusal ?? (() => json({ ...next, is_current: true }, 200));
    const { unmount } = open(
      <SetCurrentDialog
        edition={next}
        replaced={replaced}
        onClose={onClose}
        onChanged={onChanged}
      />,
    );
    const question = dialog()?.textContent ?? "";
    act(() => button("Imposta come corrente")?.click());
    await settle();
    const seen = {
      question,
      closed,
      changed,
      confirmOff: button("Imposta come corrente")?.disabled ?? null,
      text: body(),
    };
    unmount();
    return seen;
  }

  it.each([
    ["no current edition", null, "La 2025-2026 diventa l'edizione corrente."],
    ["the current one it replaces", current, "L'edizione corrente passa da 2024-2025 a 2025-2026."],
  ])("names %s, switches and says so", async (_, replaced, sentence) => {
    const seen = await switching(replaced, null);

    expect(seen.question).toContain(sentence);
    expect([seen.closed, seen.changed]).toEqual([1, 1]);
    expect(seen.text).toContain("Edizione corrente aggiornata");
    expect(seen.text).toContain("PPM · 2025-2026");
  });

  it.each([
    [
      "the switch's own refusal",
      REFUSED.switchNeedsBoth,
      "Serve il permesso anche sull'edizione corrente: chiedi alla segreteria didattica.",
    ],
    ["a missing permission", REFUSED.forbidden, "Permesso mancante: edition.set_current"],
  ])("keeps %s in the dialog with the button off", async (_, refusal, sentence) => {
    const seen = await switching(current, refusal);

    expect([seen.closed, seen.confirmOff]).toEqual([0, true]);
    expect(seen.text).toContain(sentence);
  });

  it("closes and reads the page again when the edition is gone", async () => {
    const seen = await switching(current, REFUSED.gone);

    expect([seen.closed, seen.changed]).toEqual([1, 1]);
  });
});
