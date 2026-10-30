// @vitest-environment jsdom

/**
 * The superuser's page of accounts (#167), with the network faked at
 * `fetch`: what it shows of each account, and which row offers what; what it
 * asks the server for as the reader searches, narrows and turns pages; and
 * what each change sends and does with the answer: asked about first or
 * done at once, a rule the server holds to said in the dialog, an account
 * deleted elsewhere read again, a reset link shown with its token in the
 * address's fragment, and a page emptied by a change left for the one before.
 */

import { act } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/api/account";
import { type ManagedUser, USER_PAGE_SIZE } from "@/api/admin";
import type { Invitation } from "@/api/catalog";
import type { ErrorCode } from "@/api/errors";
import { SessionContext } from "@/auth/SessionProvider";
import { Toaster } from "@/components/ui/sonner";
import i18n from "@/i18n";
import { mount } from "@/test/mount";
import { codedRefusal } from "@/test/refusal";
import { ThemeProvider } from "@/theme/ThemeProvider";
import { type Shell, ShellContext } from "./shell";
import UsersPage from "./UsersPage";

function user(id: number, username: string, changes: Partial<ManagedUser> = {}): ManagedUser {
  return {
    id,
    username,
    is_active: true,
    is_superuser: false,
    last_login: "2026-10-27T09:30:00Z",
    date_joined: "2026-09-01T08:00:00Z",
    roles: [],
    ...changes,
  };
}

const ROOT = user(1, "demo-admin", { is_superuser: true });
const TEACHER = user(2, "demo-teacher", {
  roles: [
    { role: "teacher", edition: 5 },
    { role: "teacher", edition: 6 },
    { role: "secretariat", programme: "B047" },
  ],
});
const GONE = user(3, "demo-gone", { is_active: false, last_login: null });
const STUDENT = user(4, "demo-student");

/** When an account last signed in, as the page prints it in the zone the test runs in. */
const LAST = new Intl.DateTimeFormat("it", { dateStyle: "medium", timeStyle: "short" }).format(
  new Date("2026-10-27T09:30:00Z"),
);

const ADMIN: Account = {
  id: 1,
  username: "demo-admin",
  locale: "it",
  is_superuser: true,
  roles: [],
  programme: null,
  year_of_study: null,
};

/** The accounts the server holds now. */
let accounts: ManagedUser[] = [];
/** Each request the page sent, `METHOD path`. */
let asked: string[] = [];
/** What the server answers the next request to `METHOD path`, in place of doing it. */
let refusals: Record<string, ErrorCode> = {};

/** A date and time as the page prints it, in the zone the test runs in. */
function printed(at: string): string {
  return new Intl.DateTimeFormat("it", { dateStyle: "medium", timeStyle: "short" }).format(
    new Date(at),
  );
}

const LATER = printed("2099-01-01T00:00:00Z");
const EARLIER = printed("2026-10-01T09:30:00Z");

/** Every scope's invitations: a teacher's still good, and secretariat staff's expired. */
const INVITED: Invitation[] = [
  {
    id: 7,
    role: "teacher",
    edition: {
      id: 5,
      course: { code: "B028451", name: "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE", locale: "it" },
      academic_year: "2025-2026",
    },
    programme: null,
    created_by: "demo-secretariat",
    created_at: "2026-10-27T09:30:00Z",
    expires_at: "2099-01-01T00:00:00Z",
  },
  {
    id: 8,
    role: "secretariat",
    edition: null,
    programme: { code: "B047", name: "INGEGNERIA INFORMATICA", locale: "it" },
    created_by: "demo-admin",
    created_at: "2026-10-01T09:30:00Z",
    expires_at: "2026-10-04T09:30:00Z",
  },
];

/** The invitations the server holds now. */
let invited: Invitation[] = [];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** `GET /api/admin/users` as the server pages it (apps/accounts/manage_views.py). */
function listed(url: URL): Response {
  const q = url.searchParams.get("q") ?? "";
  const active = url.searchParams.get("active");
  const page = Number(url.searchParams.get("page") ?? "1");
  const matching = accounts.filter(
    (each) => each.username.includes(q) && (active === null || String(each.is_active) === active),
  );
  const start = (page - 1) * USER_PAGE_SIZE;
  if (page > 1 && start >= matching.length) return codedRefusal("NOT_FOUND");
  return json({
    count: matching.length,
    next: start + USER_PAGE_SIZE < matching.length ? "next" : null,
    previous: page > 1 ? "previous" : null,
    results: matching.slice(start, start + USER_PAGE_SIZE),
  });
}

async function fakeApi(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const url = new URL(String(input), "http://localhost");
  const method = init.method ?? "GET";
  const key = `${method} ${url.pathname}`;
  asked.push(`${method} ${url.pathname}${url.search}`);
  const refusal = refusals[key];
  if (refusal !== undefined) {
    delete refusals[key];
    return codedRefusal(refusal);
  }
  if (key === "GET /api/admin/users") return listed(url);
  if (key === "GET /api/catalog/invitations") return json(invited);
  const revoked = /^\/api\/catalog\/(?:editions|programmes)\/\w+\/invitations\/(\d+)$/.exec(
    url.pathname,
  );
  if (method === "DELETE" && revoked !== null) {
    invited = invited.filter((each) => each.id !== Number(revoked[1]));
    return new Response(null, { status: 204 });
  }
  const [, id, action] = /^\/api\/admin\/users\/(\d+)(?:\/(.+))?$/.exec(url.pathname) ?? [];
  const target = accounts.find((each) => each.id === Number(id));
  if (target === undefined) return codedRefusal("NOT_FOUND");
  if (method === "DELETE") accounts = accounts.filter((each) => each !== target);
  else if (action === "deactivate") target.is_active = false;
  else if (action === "activate") target.is_active = true;
  else if (action === "reset-link")
    return json({ token: "tok-en_1", expires_at: "2026-10-29T10:00:00Z" }, 201);
  return new Response(null, { status: 204 });
}

const SHELL: Shell = {
  programmes: [],
  programmesError: null,
  landing: null,
  root: "programmes",
  back: { to: "/staff/programmes", label: "" },
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

async function page(reader: Account = ADMIN) {
  const router = createMemoryRouter([{ path: "/staff/users", element: <UsersPage /> }], {
    initialEntries: ["/staff/users"],
  });
  const mounted = mount(
    <ThemeProvider>
      <SessionContext
        value={{
          account: reader,
          logIn: async () => {},
          register: async () => {},
          logOut: async () => {},
          chooseLocale: async () => {},
          chooseStudies: async () => {},
          forget: () => {},
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
  return mounted;
}

/** A cell's value, without the label a stacked row prints before it (ui/table.tsx). */
function value(cell: Element | undefined): Element | null {
  return cell?.querySelector(":scope > div") ?? null;
}

/** What an element says, its parts apart: "demo-admin tu", not "demo-admintu". */
function words(element: Element): string {
  if (element.children.length === 0) return element.textContent ?? "";
  return [...element.childNodes]
    .map((node) => (node instanceof Element ? words(node) : (node.textContent ?? "").trim()))
    .filter((part) => part !== "")
    .join(" ");
}

/** The rows of the accounts' tab, the first. */
function accountRows(container: HTMLElement) {
  return [...(container.querySelector('[role="tabpanel"]')?.querySelectorAll("tbody tr") ?? [])];
}

/** Each row as the reader sees it: its cells, each a line per part, and whether it has a menu. */
function rows(container: HTMLElement) {
  return accountRows(container).map((row) => ({
    cells: [...row.querySelectorAll("td")].slice(0, 4).map((cell) => {
      const shown = value(cell);
      if (shown === null) return [];
      return shown.children.length === 0 ? [words(shown)] : [...shown.children].map(words);
    }),
    menu: row.querySelector('[aria-haspopup="menu"]') !== null,
  }));
}

/** The state the row of `username` shows. */
function stateOf(container: HTMLElement, username: string) {
  return value(row(container, username)?.querySelectorAll("td")[2])?.textContent;
}

function row(container: HTMLElement, username: string) {
  return accountRows(container).find((each) => each.textContent?.includes(username));
}

/** Opens the row's menu: Radix opens it on pointerdown (components/AccountMenu.test.tsx). */
function openMenu(container: HTMLElement, username: string) {
  const trigger = row(container, username)?.querySelector('[aria-haspopup="menu"]');
  act(() => {
    trigger?.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, button: 0 }));
  });
}

const items = () =>
  [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].map(
    (item) => item.textContent,
  );

/** Picks the item of the row's menu, and lets the menu close and run it. */
async function choose(container: HTMLElement, username: string, item: string) {
  openMenu(container, username);
  const picked = [...document.body.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(
    (each) => each.textContent === item,
  );
  act(() => picked?.click());
  await settle();
}

async function confirm(label: string) {
  const button = [...document.body.querySelectorAll<HTMLElement>("[role=alertdialog] button")].find(
    (each) => each.textContent === label,
  );
  act(() => button?.click());
  await settle();
}

function type(input: HTMLInputElement | null, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    if (input !== null) setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(container: ParentNode, name: string) {
  const button = [...container.querySelectorAll<HTMLElement>("button")].find(
    (each) => each.textContent === name,
  );
  act(() => button?.click());
}

/** The newest toast: sonner keeps its toasts across the cases of a file. */
const toast = () => document.body.querySelector("[data-sonner-toast]")?.textContent;

const lists = () => asked.filter((each) => each.startsWith("GET /api/admin/users"));

beforeEach(() => {
  accounts = [ROOT, TEACHER, GONE, STUDENT].map((each) => structuredClone(each));
  asked = [];
  refusals = {};
  invited = [...INVITED];
  vi.stubGlobal("fetch", fakeApi);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("the accounts page", () => {
  it("shows each account, and a menu on every row but the reader's own", async () => {
    const { container, unmount } = await page();
    const shown = rows(container);
    unmount();

    expect(shown).toEqual([
      {
        cells: [["demo-admin tu", "dal 1 set 2026"], ["Amministratore"], ["Attivo"], [LAST]],
        menu: false,
      },
      {
        // Each role once, the widest first.
        cells: [["demo-teacher", "dal 1 set 2026"], ["Segreteria Docente"], ["Attivo"], [LAST]],
        menu: true,
      },
      {
        cells: [["demo-gone", "dal 1 set 2026"], ["Studente"], ["Disattivato"], ["Mai"]],
        menu: true,
      },
      {
        cells: [["demo-student", "dal 1 set 2026"], ["Studente"], ["Attivo"], [LAST]],
        menu: true,
      },
    ]);
  });

  it("is not found for staff who are not the superuser, who ask the server nothing", async () => {
    const reader: Account = {
      ...ADMIN,
      is_superuser: false,
      roles: [{ role: "teacher", edition: 5 }],
    };
    const { container, unmount } = await page(reader);
    const heading = container.querySelector("h1, h2")?.textContent;
    unmount();

    expect({ heading, asked }).toEqual({ heading: "Non trovato", asked: [] });
  });

  it("asks for what the search and the state narrow to, from the first page", async () => {
    accounts = [ROOT, ...Array.from({ length: 60 }, (_, i) => user(10 + i, `demo-${100 + i}`))];
    const { container, unmount } = await page();
    press(container, "Successiva");
    await settle();
    const search = container.querySelector<HTMLInputElement>('input[type="search"]');
    act(() => search?.focus());
    type(search, "demo-1");
    await settle();
    // The list stays while the search is read, the field with it, for the next letter.
    const typing = document.activeElement === search;
    const deactivated = [...container.querySelectorAll<HTMLElement>("button")].find(
      (each) => each.textContent === "Disattivati",
    );
    act(() => {
      deactivated?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();
    unmount();

    expect({ typing, asked: lists() }).toEqual({
      typing: true,
      asked: [
        "GET /api/admin/users",
        "GET /api/admin/users?page=2",
        "GET /api/admin/users?q=demo-1",
        "GET /api/admin/users?q=demo-1&active=false",
      ],
    });
  });

  it.each([
    {
      username: "demo-student",
      offered: ["Disattiva", "Disconnetti ovunque", "Link per la password"],
    },
    { username: "demo-gone", offered: ["Riattiva", "Link per la password", "Elimina"] },
  ])("offers $username what would change it now", async ({ username, offered }) => {
    const { container, unmount } = await page();
    openMenu(container, username);
    const seen = items();
    unmount();

    expect(seen).toEqual(offered);
  });
});

describe("a change to an account", () => {
  it.each([
    {
      item: "Disattiva",
      username: "demo-student",
      sent: "POST /api/admin/users/4/deactivate",
      done: "staff.users.deactivate.done",
      state: "Disattivato",
    },
    {
      item: "Disconnetti ovunque",
      username: "demo-student",
      sent: "POST /api/admin/users/4/sessions/end",
      done: "staff.users.sessions.done",
      state: "Attivo",
    },
    {
      item: "Elimina",
      username: "demo-gone",
      sent: "DELETE /api/admin/users/3",
      done: "staff.users.delete.done",
      state: undefined,
    },
  ])(
    "$item asks first, then is sent and read again",
    async ({ item, username, sent, done, state }) => {
      const { container, unmount } = await page();
      await choose(container, username, item);
      const before = asked.filter((each) => !each.startsWith("GET"));
      await confirm(item);
      const seen = {
        before,
        after: asked.filter((each) => !each.startsWith("GET")),
        reads: lists().length,
        state: stateOf(container, username),
        toast: toast(),
      };
      unmount();

      expect(seen).toEqual({
        before: [],
        after: [sent],
        reads: 2,
        state,
        toast: `${i18n.t(done)}${username}`,
      });
    },
  );

  it("reactivating is sent at once", async () => {
    const { container, unmount } = await page();
    await choose(container, "demo-gone", "Riattiva");
    const seen = {
      dialog: document.body.querySelector("[role=alertdialog]"),
      sent: asked.filter((each) => !each.startsWith("GET")),
      state: stateOf(container, "demo-gone"),
    };
    unmount();

    expect(seen).toEqual({
      dialog: null,
      sent: ["POST /api/admin/users/3/activate"],
      state: "Attivo",
    });
  });

  it("a rule the server holds to is said in the dialog, which stays open", async () => {
    refusals["DELETE /api/admin/users/3"] = "ACCOUNT_STILL_ACTIVE";
    const { container, unmount } = await page();
    await choose(container, "demo-gone", "Elimina");
    await confirm("Elimina");
    const said = document.body.querySelector("[role=alertdialog] [role=alert]")?.textContent;
    unmount();

    expect(said).toBe("Disattiva l'account prima di eliminarlo.");
  });

  it("an account deleted elsewhere is read again and said", async () => {
    const { container, unmount } = await page();
    await choose(container, "demo-student", "Disattiva");
    accounts = accounts.filter((each) => each.username !== "demo-student");
    await confirm("Disattiva");
    const seen = {
      dialog: document.body.querySelector("[role=alertdialog]"),
      row: row(container, "demo-student"),
      toast: toast(),
    };
    unmount();

    expect(seen).toEqual({
      dialog: null,
      row: undefined,
      toast: i18n.t("staff.users.gone", { username: "demo-student" }),
    });
  });

  it("a reset link is shown once, its token in the address's fragment", async () => {
    const { container, unmount } = await page();
    await choose(container, "demo-gone", "Link per la password");
    const dialog = document.body.querySelector("[role=dialog]");
    const seen = {
      sent: asked.filter((each) => !each.startsWith("GET")),
      heading: dialog?.querySelector("h2")?.textContent,
      link: dialog?.querySelector<HTMLInputElement>("input")?.value,
    };
    unmount();

    expect(seen).toEqual({
      sent: ["POST /api/admin/users/3/reset-link"],
      heading: "Link per la password",
      link: `${window.location.origin}/reset#tok-en_1`,
    });
  });

  it("a page emptied by a change is left for the one before", async () => {
    accounts = [
      ROOT,
      ...Array.from({ length: USER_PAGE_SIZE }, (_, i) =>
        user(10 + i, `demo-${100 + i}`, { is_active: false }),
      ),
    ];
    const { container, unmount } = await page();
    press(container, "Successiva");
    await settle();
    await choose(container, "demo-149", "Elimina");
    await confirm("Elimina");
    const seen = { reads: lists(), page: container.querySelector("nav")?.textContent };
    unmount();

    expect(seen).toEqual({
      reads: ["GET /api/admin/users", "GET /api/admin/users?page=2", "GET /api/admin/users"],
      page: undefined,
    });
  });
});

describe("every scope's invitations", () => {
  /** The rows of the invitations' tab: each cell's text, and where the scope leads. */
  function invitationRows(container: HTMLElement) {
    const panel = container.querySelectorAll('[role="tabpanel"]')[1];
    return [...(panel?.querySelectorAll("tbody tr") ?? [])].map((each) => ({
      cells: [...each.querySelectorAll("td")].slice(0, 3).map((cell) => {
        const shown = value(cell);
        return shown === null ? "" : words(shown);
      }),
      to: each.querySelector("a")?.getAttribute("href"),
    }));
  }

  it("names each one's role and scope, who made it and when, and when it stops working", async () => {
    const { container, unmount } = await page();
    const seen = {
      tab: [...container.querySelectorAll('[role="tab"]')].map((tab) => words(tab)),
      rows: invitationRows(container),
    };
    unmount();

    expect(seen).toEqual({
      tab: ["Account 4", "Inviti in sospeso 2"],
      rows: [
        {
          cells: [
            "Docente PROGETTAZIONE E PRODUZIONE MULTIMEDIALE · 2025-2026",
            `demo-secretariat ${LAST}`,
            LATER,
          ],
          to: "/staff/editions/5",
        },
        {
          cells: ["Segreteria INGEGNERIA INFORMATICA", `demo-admin ${EARLIER}`, "Scaduto"],
          to: "/staff/programmes/B047",
        },
      ],
    });
  });

  it("revokes one under its own scope, after asking, and reads the list again", async () => {
    const { container, unmount } = await page();
    const panel = container.querySelectorAll('[role="tabpanel"]')[1];
    const revoke = panel?.querySelectorAll<HTMLButtonElement>("[data-revoke-invitation]")[1];
    act(() => revoke?.click());
    await confirm("Revoca");
    const seen = {
      sent: asked.filter((each) => each.startsWith("DELETE")),
      reads: asked.filter((each) => each === "GET /api/catalog/invitations").length,
      rows: invitationRows(container).map((each) => each.to),
    };
    unmount();

    expect(seen).toEqual({
      sent: ["DELETE /api/catalog/programmes/B047/invitations/8"],
      reads: 2,
      rows: ["/staff/editions/5"],
    });
  });
});
