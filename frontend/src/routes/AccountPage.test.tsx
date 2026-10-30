// @vitest-environment jsdom

/**
 * The account's page (#167), with the network faked at `fetch`: what it
 * shows of what the server answers, the roles by their scopes' names and
 * each device by its browser and system, the current one marked and never
 * offered to end; what it sends for each change, the programme and year
 * through the session as each is chosen; and what it does with each
 * answer: a wrong password said at the password, a device already gone
 * taken as ended, a deletion the account's rules refuse said in the dialog,
 * and one accepted leaving for the front page as a visitor.
 */

import { act } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account, AccountSession, Studies } from "@/api/account";
import type { Edition, Programme, ProgrammeName } from "@/api/catalog";
import type { ErrorCode, FieldViolation } from "@/api/errors";
import { ApiError } from "@/api/http";
import { SessionContext } from "@/auth/SessionProvider";
import { Toaster } from "@/components/ui/sonner";
import { readDraft, writeDraft } from "@/features/chat/draft";
import i18n from "@/i18n";
import { mount } from "@/test/mount";
import { codedRefusal } from "@/test/refusal";
import { ThemeProvider } from "@/theme/ThemeProvider";
import AccountPage from "./AccountPage";
import { type Shell, ShellContext } from "./shell";

const CHROME_WINDOWS =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36";
const EDGE_MAC =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36 Edg/141.0.0.0";
const SAFARI_IPHONE =
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1";
const FIREFOX_ANDROID = "Mozilla/5.0 (Android 15; Mobile; rv:143.0) Gecko/143.0 Firefox/143.0";

function device(id: string, userAgent: string, current = false): AccountSession {
  return {
    id,
    current,
    user_agent: userAgent,
    ip: "203.0.113.5",
    authenticated_at: "2026-10-20T08:00:00Z",
    last_activity: "2026-10-28T09:30:00Z",
  };
}

const SESSIONS: AccountSession[] = [
  device("here", CHROME_WINDOWS, true),
  device("mac", EDGE_MAC),
  device("phone", SAFARI_IPHONE),
  device("tablet", FIREFOX_ANDROID),
  device("script", "curl/8.4.0"),
  device("blank", ""),
];

const B047: Programme = {
  code: "B047",
  name: "INGEGNERIA INFORMATICA",
  locale: "it",
  curricula: [],
  course_count: 1,
  secretariat: [],
  permissions: ["programme.view"],
};

const EDITION: Edition = {
  id: 5,
  course: {
    code: "B028451",
    name: "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE",
    locale: "it",
    code_source: "moodle",
    entries: [],
  },
  academic_year: "2025-2026",
  teaching_starts: null,
  period: "",
  is_current: true,
  teachers: [],
  permissions: ["edition.view"],
};

function account(superuser: boolean, roles: Account["roles"]): Account {
  return {
    id: 7,
    username: "demo-reader",
    locale: "it",
    is_superuser: superuser,
    roles,
    programme: null,
    year_of_study: null,
  };
}

const STUDENT = account(false, []);

const PROGRAMMES: ProgrammeName[] = [
  { code: "B047", name: "INGEGNERIA INFORMATICA", locale: "it" },
  { code: "B060", name: "INFORMATICA", locale: "it" },
];

/** A student of B047 in its second year. */
const SECOND_YEAR: Account = { ...STUDENT, programme: "B047", year_of_study: 2 };

/** The devices the server holds now. */
let devices: AccountSession[] = [];
/** Each write the page sent: `METHOD path` and its body. */
let sent: { to: string; body: unknown }[] = [];
/** What the server answers the next write to a path, in place of doing it. */
let refusals: Record<string, Response> = {};

function json(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

async function fakeApi(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const path = String(input);
  const method = init.method ?? "GET";
  if (method === "GET" && path === "/api/auth/sessions") return json(devices);
  if (method === "GET" && path === "/api/catalog/editions") return json([EDITION]);
  if (method === "GET" && path === "/api/auth/programmes") return json(PROGRAMMES);
  if (method !== "POST") return codedRefusal("NOT_FOUND");
  const body = JSON.parse(String(init.body)) as { session?: string };
  sent.push({ to: path, body });
  const refusal = refusals[path];
  if (refusal !== undefined) {
    delete refusals[path];
    return refusal;
  }
  // What the server does: a change of password, and "others", end every
  // device but this one.
  const ends = path === "/api/auth/password" || body.session === "others";
  if (ends || path === "/api/auth/sessions/end")
    devices = devices.filter((each) => each.current || (!ends && each.id !== body.session));
  return new Response(null, { status: 204 });
}

const SHELL: Shell = {
  programmes: [B047],
  programmesError: null,
  landing: null,
  root: null,
  back: { to: "/", label: "" },
  setTrail: () => {},
  refreshConversations: () => {},
  setBusy: () => {},
};

async function settle() {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function page(reader: Account = STUDENT, chooseStudies = async (_: Studies) => {}) {
  const forget = vi.fn();
  const router = createMemoryRouter(
    [
      { path: "/account", element: <AccountPage /> },
      { path: "/", element: <p id="front" /> },
    ],
    { initialEntries: ["/account"] },
  );
  const mounted = mount(
    <ThemeProvider>
      <SessionContext
        value={{
          account: reader,
          logIn: async () => {},
          register: async () => {},
          logOut: async () => {},
          chooseLocale: async () => {},
          chooseStudies,
          forget,
          recheck: async () => {},
        }}
      >
        <ShellContext value={SHELL}>
          <RouterProvider router={router} />
          <Toaster />
        </ShellContext>
      </SessionContext>
    </ThemeProvider>,
  );
  await settle();
  return { ...mounted, forget, path: () => router.state.location.pathname };
}

function type(input: HTMLInputElement | null, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    if (input !== null) setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function choose(select: HTMLSelectElement | null, value: string) {
  act(() => {
    if (select !== null) select.value = value;
    select?.dispatchEvent(new Event("change", { bubbles: true }));
  });
}

function press(scope: ParentNode, name: string) {
  const button = [...scope.querySelectorAll("button")].find(
    (candidate) => candidate.textContent === name || candidate.getAttribute("aria-label") === name,
  );
  act(() => button?.click());
}

/** The open dialog, sent with `password`. */
async function confirm(password: string) {
  type(document.body.querySelector<HTMLInputElement>("#reauth-password"), password);
  await act(async () => {
    document.body.querySelector<HTMLFormElement>("[role=dialog] form")?.requestSubmit();
  });
  await settle();
}

/** The text of what describes `input`. */
function said(input: Element | null): string | undefined {
  const ids = input?.getAttribute("aria-describedby")?.split(" ") ?? [];
  return ids.map((id) => document.getElementById(id)?.textContent ?? "").join(" ");
}

function rows(container: HTMLElement) {
  return [...container.querySelectorAll("tbody tr")].map((row) => ({
    device: row.querySelector("td")?.textContent,
    endable: row.querySelector("button") !== null,
  }));
}

beforeEach(() => {
  devices = [...SESSIONS];
  sent = [];
  refusals = {};
  sessionStorage.clear();
  vi.stubGlobal("fetch", fakeApi);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the account's page shows", () => {
  it.each([
    {
      who: "staff of two scopes",
      reader: account(false, [
        { role: "secretariat", programme: "B047" },
        { role: "teacher", edition: 5 },
      ]),
      roles: [
        ["Segreteria INGEGNERIA INFORMATICA", "/staff/programmes/B047"],
        ["Docente PROGETTAZIONE E PRODUZIONE MULTIMEDIALE · 2025-2026", "/staff/editions/5"],
      ],
    },
    {
      who: "a superuser who teaches",
      reader: account(true, [{ role: "teacher", edition: 5 }]),
      roles: [
        ["Amministratore", null],
        ["Docente PROGETTAZIONE E PRODUZIONE MULTIMEDIALE · 2025-2026", "/staff/editions/5"],
      ],
    },
    // The head's one word says it all, and no section repeats it.
    { who: "a superuser alone", reader: account(true, []), roles: null },
    { who: "a student", reader: STUDENT, roles: null },
  ])("for $who, each role held on a scope by the scope's name", async ({ reader, roles }) => {
    const { container, unmount } = await page(reader);
    const section = [...container.querySelectorAll("section")].find(
      (candidate) => candidate.querySelector("h2")?.textContent === i18n.t("account.roles"),
    );
    const shown =
      section === undefined
        ? null
        : [...section.querySelectorAll("li")].map((item) => [
            [...item.childNodes].map((part) => part.textContent).join(" "),
            item.querySelector("a")?.getAttribute("href") ?? null,
          ]);
    unmount();

    expect(shown).toEqual(roles);
  });

  it("each device by its browser and system, this one marked and never offered to end", async () => {
    const { container, unmount } = await page();
    const shown = rows(container);
    unmount();

    expect(shown).toEqual([
      { device: `Chrome · Windows${i18n.t("account.sessions.current")}`, endable: false },
      { device: "Edge · macOS", endable: true },
      { device: "Safari · iOS", endable: true },
      { device: "Firefox · Android", endable: true },
      { device: "curl/8.4.0", endable: true },
      { device: i18n.t("account.sessions.unknown"), endable: true },
    ]);
  });
});

describe("a change the page sends", () => {
  it.each([
    {
      change: "ending one device",
      run: async (container: HTMLElement) => {
        press(container, `${i18n.t("account.sessions.end")} · Safari · iOS`);
        await confirm("segreta");
      },
      to: "/api/auth/sessions/end",
      body: { password: "segreta", session: "phone" },
      left: ["here", "mac", "tablet", "script", "blank"],
      toast: i18n.t("account.sessions.ended"),
    },
    {
      change: "ending the others",
      run: async (container: HTMLElement) => {
        press(container, i18n.t("account.sessions.endOthers"));
        await confirm("segreta");
      },
      to: "/api/auth/sessions/end",
      body: { password: "segreta", session: "others" },
      left: ["here"],
      toast: i18n.t("account.sessions.endedOthers"),
    },
    {
      change: "changing the password",
      run: async (container: HTMLElement) => {
        type(container.querySelector<HTMLInputElement>("#password"), "vecchia-segreta");
        type(
          container.querySelector<HTMLInputElement>("#new_password"),
          "nuovo cavallo batteria graffetta",
        );
        await act(async () => {
          container.querySelector<HTMLFormElement>("#new_password")?.form?.requestSubmit();
        });
        await settle();
      },
      to: "/api/auth/password",
      body: { password: "vecchia-segreta", new_password: "nuovo cavallo batteria graffetta" },
      left: ["here"],
      toast: i18n.t("account.password.done"),
    },
  ])("$change: sent, then the devices read again", async ({ run, to, body, left, toast }) => {
    const { container, unmount } = await page();
    await run(container);
    const after = {
      sent,
      devices: rows(container).length,
      dialog: document.body.querySelector("[role=dialog]") !== null,
      fields: [...container.querySelectorAll<HTMLInputElement>("form input[type=password]")].map(
        (input) => input.value,
      ),
      toast: document.body.querySelector("[data-sonner-toast]")?.textContent ?? "",
    };
    unmount();

    expect(after).toEqual({
      sent: [{ to, body }],
      devices: left.length,
      dialog: false,
      fields: ["", ""],
      toast: expect.stringContaining(toast),
    });
  });
});

describe("what the account studies", () => {
  it.each([
    { who: "a student of B047 in its second year", reader: SECOND_YEAR, shown: ["B047", "2"] },
    // No year is offered without a programme.
    { who: "an account that said nothing", reader: STUDENT, shown: [""] },
  ])("is shown for $who as the account holds it", async ({ reader, shown }) => {
    const { container, unmount } = await page(reader);
    const values = [
      ...container.querySelectorAll<HTMLSelectElement>("#programme, #year_of_study"),
    ].map((select) => select.value);
    unmount();

    expect(values).toEqual(shown);
  });

  it.each([
    {
      change: "a programme chosen",
      reader: STUDENT,
      field: "#programme",
      value: "B060",
      written: { programme: "B060", year_of_study: null },
    },
    {
      change: "another year",
      reader: SECOND_YEAR,
      field: "#year_of_study",
      value: "3",
      written: { programme: "B047", year_of_study: 3 },
    },
    {
      change: "no programme, which clears the year",
      reader: SECOND_YEAR,
      field: "#programme",
      value: "",
      written: { programme: null, year_of_study: null },
    },
  ])("$change: written as it is chosen", async ({ reader, field, value, written }) => {
    const chooseStudies = vi.fn(async (_: Studies) => {});
    const { container, unmount } = await page(reader, chooseStudies);
    choose(container.querySelector<HTMLSelectElement>(field), value);
    await settle();
    unmount();

    expect(chooseStudies.mock.calls).toEqual([[written]]);
  });

  it("refused, a programme gone since the list was read: said under it, the account's shown again", async () => {
    const chooseStudies = async () => {
      throw new ApiError({
        status: 400,
        code: "INVALID_ARGUMENT",
        violations: [{ field: "programme", reason: "INVALID", data: {} }],
      });
    };
    const { container, unmount } = await page(STUDENT, chooseStudies);
    choose(container.querySelector<HTMLSelectElement>("#programme"), "B060");
    await settle();
    const field = container.querySelector<HTMLSelectElement>("#programme");
    const after = {
      value: field?.value,
      said: said(field),
      focused: document.activeElement === field,
    };
    unmount();

    expect(after).toEqual({ value: "", said: i18n.t("errors.field.INVALID"), focused: true });
  });
});

function refusal(code: ErrorCode, fields: FieldViolation[] = []) {
  return codedRefusal(code, { fields });
}

describe("a refusal", () => {
  it("of the password asked again: said under it, emptied, and the dialog stays", async () => {
    refusals["/api/auth/sessions/end"] = refusal("WRONG_CREDENTIALS");
    const { container, unmount } = await page();
    press(container, i18n.t("account.sessions.endOthers"));
    await confirm("sbagliata");
    const field = document.body.querySelector<HTMLInputElement>("#reauth-password");
    const after = { value: field?.value, said: said(field), devices: rows(container).length };
    unmount();

    expect(after).toEqual({
      value: "",
      said: i18n.t("account.wrongPassword"),
      devices: SESSIONS.length,
    });
  });

  it("of a device already gone: it was the outcome asked for", async () => {
    const { container, unmount } = await page();
    // Ended from another device since the page read the list.
    devices = SESSIONS.filter((each) => each.id !== "phone");
    refusals["/api/auth/sessions/end"] = refusal("NOT_FOUND");
    press(container, `${i18n.t("account.sessions.end")} · Safari · iOS`);
    await confirm("segreta");
    const after = {
      dialog: document.body.querySelector("[role=dialog]") !== null,
      devices: rows(container).length,
    };
    unmount();

    expect(after).toEqual({ dialog: false, devices: SESSIONS.length - 1 });
  });

  it.each([
    {
      refused: "a wrong current password",
      answer: () => refusal("WRONG_CREDENTIALS"),
      field: "#password",
      said: i18n.t("account.wrongPassword"),
      kept: ["", "nuovo cavallo batteria graffetta"],
    },
    {
      refused: "a new password too short",
      answer: () =>
        refusal("INVALID_ARGUMENT", [
          { field: "new_password", reason: "TOO_SHORT", data: { min_length: 15 } },
        ]),
      field: "#new_password",
      // After the hint of the rules, which the field keeps.
      said: `${i18n.t("auth.passwordHint")} ${i18n.t("errors.field.TOO_SHORT", { min_length: 15 })}`,
      kept: ["vecchia-segreta", "nuovo cavallo batteria graffetta"],
    },
  ])("of the password change, $refused: said at its field", async (case_) => {
    refusals["/api/auth/password"] = case_.answer();
    const { container, unmount } = await page();
    type(container.querySelector<HTMLInputElement>("#password"), "vecchia-segreta");
    type(
      container.querySelector<HTMLInputElement>("#new_password"),
      "nuovo cavallo batteria graffetta",
    );
    await act(async () => {
      container.querySelector<HTMLFormElement>("#password")?.form?.requestSubmit();
    });
    await settle();
    const field = container.querySelector<HTMLInputElement>(case_.field);
    const after = {
      said: said(field),
      focused: document.activeElement === field,
      kept: [...container.querySelectorAll<HTMLInputElement>("form input[type=password]")].map(
        (input) => input.value,
      ),
    };
    unmount();

    expect(after).toEqual({ said: case_.said, focused: true, kept: case_.kept });
  });
});

describe("deleting the account", () => {
  it.each(["ROLES_HELD", "LAST_SUPERUSER"] as const)(
    "refused by the rule %s: said in the dialog, and the account stays",
    async (code) => {
      refusals["/api/auth/me/delete"] = refusal(code);
      const { container, forget, path, unmount } = await page();
      press(container, i18n.t("account.delete.confirm"));
      await confirm("segreta");
      const after = {
        alert: document.body.querySelector("[role=dialog] [role=alert]")?.textContent,
        path: path(),
        forgotten: forget.mock.calls.length,
      };
      unmount();

      expect(after).toEqual({ alert: i18n.t(`errors.${code}`), path: "/account", forgotten: 0 });
    },
  );

  it("accepted: signed out, the draft forgotten, and on to the front page", async () => {
    writeDraft(STUDENT.id, "/", "una domanda a metà");
    const { container, forget, path, unmount } = await page();
    press(container, i18n.t("account.delete.confirm"));
    await confirm("segreta");
    const after = {
      sent,
      path: path(),
      forgotten: forget.mock.calls.length,
      draft: readDraft(STUDENT.id, "/"),
    };
    unmount();

    expect(after).toEqual({
      sent: [{ to: "/api/auth/me/delete", body: { password: "segreta" } }],
      path: "/",
      forgotten: 1,
      draft: "",
    });
  });
});
