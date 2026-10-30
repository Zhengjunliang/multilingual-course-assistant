// @vitest-environment jsdom

/**
 * The two pages a handed-out link opens (routes/link.tsx), with the network
 * faked at `fetch`: the reset link's and the invitation's. Each looks its
 * link up with the token of the address's fragment, in a body; a dead link,
 * or an address with no token, is said and offers nothing to send; a link
 * that dies while the page holds it is said the same way. A reset sends the
 * new password and goes on to the login; an invitation names its role and
 * scope, makes an account or takes the one signed in, reads the session
 * again and goes on to the scope's page. A refused field leaves the link
 * working, and is said at the field.
 */

import { act, type ReactNode, useState } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/api/account";
import type { InvitationGrant } from "@/api/catalog";
import type { ErrorCode, FieldViolation } from "@/api/errors";
import { SessionContext } from "@/auth/SessionProvider";
import i18n from "@/i18n";
import { mount } from "@/test/mount";
import { codedRefusal } from "@/test/refusal";
import InvitePage from "./InvitePage";
import ResetPage from "./ResetPage";

const TOKEN = "QmFzZTY0LXVybCB0b2tlbg";

const TEACHER: InvitationGrant = {
  role: "teacher",
  edition: {
    id: 5,
    course: { code: "B028451", name: "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE", locale: "it" },
    academic_year: "2025-2026",
  },
  programme: null,
};

const SECRETARIAT: InvitationGrant = {
  role: "secretariat",
  edition: null,
  programme: { code: "B047", name: "INGEGNERIA INFORMATICA", locale: "it" },
};

const READER: Account = {
  id: 3,
  username: "demo-reader",
  locale: "it",
  is_superuser: false,
  roles: [],
  programme: null,
  year_of_study: null,
};

/** Each request the page sent: `path` and its body. */
let sent: { to: string; body: unknown }[] = [];
/** What the server answers each path; a path missing is a 204. */
let answers: Record<string, () => Response> = {};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function fakeApi(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
  const path = String(input);
  sent.push({ to: path, body: JSON.parse(String(init.body)) });
  return answers[path]?.() ?? new Response(null, { status: 204 });
}

function refusal(code: ErrorCode, fields: FieldViolation[] = []) {
  return () => codedRefusal(code, { fields });
}

async function settle() {
  for (let turn = 0; turn < 4; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** The session as the page reads it, which `forget` empties as the real one does. */
function Session(props: {
  account: Account | null;
  onForget: () => void;
  logOut: () => Promise<void>;
  /** The account the server reads, or `undefined` for the one the page holds. */
  recheck: () => Promise<Account | null | undefined>;
  children: ReactNode;
}) {
  const [account, setAccount] = useState(props.account);
  return (
    <SessionContext
      value={{
        account,
        logIn: async () => {},
        register: async () => {},
        logOut: props.logOut,
        chooseLocale: async () => {},
        chooseStudies: async () => {},
        forget: () => {
          props.onForget();
          setAccount(null);
        },
        recheck: async () => {
          const read = await props.recheck();
          if (read !== undefined) setAccount(read);
        },
      }}
    >
      {props.children}
    </SessionContext>
  );
}

function open(
  path: string,
  session: { account?: Account | null; recheck?: () => Promise<Account | null | undefined> },
) {
  const recheck = vi.fn(session.recheck ?? (async () => undefined));
  const logOut = vi.fn(async () => {});
  const forget = vi.fn();
  const marker = (id: string): ReactNode => <p id={id} />;
  const router = createMemoryRouter(
    [
      { path: "/reset", element: <ResetPage /> },
      { path: "/invite", element: <InvitePage /> },
      { path: "/login", element: marker("login") },
      { path: "/staff/editions/:id", element: marker("edition") },
      { path: "/staff/programmes/:code", element: marker("programme") },
    ],
    { initialEntries: [path] },
  );
  const mounted = mount(
    <Session account={session.account ?? null} onForget={forget} logOut={logOut} recheck={recheck}>
      <RouterProvider router={router} />
    </Session>,
  );
  return {
    ...mounted,
    recheck,
    logOut,
    forget,
    path: () => router.state.location.pathname,
  };
}

function type(input: HTMLInputElement | null, value: string) {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  act(() => {
    if (input !== null) setter?.call(input, value);
    input?.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

async function send(container: HTMLElement) {
  await act(async () => {
    container.querySelector("form")?.requestSubmit();
  });
  await settle();
}

beforeEach(() => {
  sent = [];
  answers = {
    "/api/auth/reset/lookup": () => json({ username: "demo-forgetful" }),
    "/api/auth/invitation/lookup": () => json(TEACHER),
    "/api/auth/invitation/accept": () => json({ authenticated: true, user: READER }, 201),
  };
  vi.stubGlobal("fetch", fakeApi);
  // With reduced motion an accepted form leaves at once (routes/landing.ts).
  vi.stubGlobal("matchMedia", (query: string) => ({
    matches: query.includes("reduced-motion"),
    media: query,
    addEventListener: () => {},
    removeEventListener: () => {},
  }));
});

afterEach(async () => {
  vi.unstubAllGlobals();
  await act(() => i18n.changeLanguage("it"));
});

/** The button that looks a link up again, if the page offers it. */
function retryButton(container: HTMLElement): HTMLButtonElement | undefined {
  return [...container.querySelectorAll("button")].find(
    (button) => button.textContent === i18n.t("auth.retry"),
  );
}

describe("a dead link", () => {
  it.each([
    { page: "/reset", lookup: "/api/auth/reset/lookup" },
    { page: "/invite", lookup: "/api/auth/invitation/lookup" },
  ])("on $page: said, with nothing to send", async ({ page, lookup }) => {
    answers[lookup] = refusal("LINK_EXPIRED");
    const opened = open(`${page}#${TOKEN}`, {});
    await settle();
    const dead = {
      alert: opened.container.querySelector("[role=alert]")?.textContent,
      form: opened.container.querySelector("form") !== null,
      retry: retryButton(opened.container) !== undefined,
      sent,
    };
    opened.unmount();

    expect(dead).toEqual({
      alert: i18n.t("errors.LINK_EXPIRED"),
      form: false,
      retry: false,
      sent: [{ to: lookup, body: { token: TOKEN } }],
    });
  });

  it.each([
    { page: "/reset", lookup: "/api/auth/reset/lookup", target: { username: READER.username } },
    { page: "/invite", lookup: "/api/auth/invitation/lookup", target: TEACHER },
  ])(
    "not one on $page, its lookup refused for too many attempts: asked again on request",
    async ({ page, lookup, target }) => {
      answers[lookup] = () =>
        codedRefusal("RESOURCE_EXHAUSTED", { data: { retry_after_seconds: 30 } });
      const opened = open(`${page}#${TOKEN}`, {});
      await settle();
      const refused = {
        said: opened.container.querySelector("[role=alert]") !== null,
        form: opened.container.querySelector("form") !== null,
      };
      answers[lookup] = () => json(target);
      act(() => retryButton(opened.container)?.click());
      await settle();
      const after = {
        refused,
        form: opened.container.querySelector("form") !== null,
        retry: retryButton(opened.container) !== undefined,
        sent: sent.length,
      };
      opened.unmount();

      expect(after).toEqual({
        refused: { said: true, form: false },
        form: true,
        retry: false,
        sent: 2,
      });
    },
  );

  it.each(["/reset", "/invite"])("with no token on %s: said, and nothing asked", async (page) => {
    const opened = open(page, {});
    await settle();
    const dead = {
      alert: opened.container.querySelector("[role=alert]")?.textContent,
      sent: sent.length,
    };
    opened.unmount();

    expect(dead).toEqual({ alert: i18n.t("errors.LINK_EXPIRED"), sent: 0 });
  });

  it.each([
    { page: "/reset", send: "/api/auth/reset" },
    { page: "/invite", send: "/api/auth/invitation/accept" },
  ])("dying while $page holds it: said the same way", async ({ page, send: to }) => {
    answers[to] = refusal("LINK_EXPIRED");
    const opened = open(`${page}#${TOKEN}`, {});
    await settle();
    type(opened.container.querySelector<HTMLInputElement>("#username"), "demo-new");
    type(
      opened.container.querySelector<HTMLInputElement>("#password, #new_password"),
      "cavallo batteria graffetta",
    );
    await send(opened.container);
    const dead = {
      alert: opened.container.querySelector("[role=alert]")?.textContent,
      form: opened.container.querySelector("form") !== null,
    };
    opened.unmount();

    expect(dead).toEqual({ alert: i18n.t("errors.LINK_EXPIRED"), form: false });
  });
});

describe("a reset link", () => {
  it.each([
    { signedIn: "nobody", account: null, forgotten: 0 },
    // Its session ended with every other of the account.
    {
      signedIn: "the link's account",
      account: { ...READER, username: "demo-forgetful" },
      forgotten: 1,
    },
    { signedIn: "another account", account: READER, forgotten: 0 },
  ])(
    "signed in as $signedIn: names its account, sends the new password, and goes on to the login",
    async ({ account, forgotten }) => {
      const opened = open(`/reset#${TOKEN}`, { account });
      await settle();
      const username = opened.container.querySelector<HTMLInputElement>("#username");
      const named = { value: username?.value, readOnly: username?.readOnly };
      type(
        opened.container.querySelector<HTMLInputElement>("#new_password"),
        "cavallo batteria graffetta",
      );
      await send(opened.container);
      const after = {
        named,
        sent,
        path: opened.path(),
        forgotten: opened.forget.mock.calls.length,
      };
      opened.unmount();

      expect(after).toEqual({
        forgotten,
        named: { value: "demo-forgetful", readOnly: true },
        sent: [
          { to: "/api/auth/reset/lookup", body: { token: TOKEN } },
          {
            to: "/api/auth/reset",
            body: { token: TOKEN, new_password: "cavallo batteria graffetta" },
          },
        ],
        path: "/login",
      });
    },
  );

  it("refused a weak password: said at the field, and the link still works", async () => {
    answers["/api/auth/reset"] = refusal("INVALID_ARGUMENT", [
      { field: "new_password", reason: "TOO_COMMON", data: {} },
    ]);
    const opened = open(`/reset#${TOKEN}`, {});
    await settle();
    type(opened.container.querySelector<HTMLInputElement>("#new_password"), "password");
    await send(opened.container);
    const field = opened.container.querySelector<HTMLInputElement>("#new_password");
    const after = {
      said: document.getElementById("new_password-refused")?.textContent,
      focused: document.activeElement === field,
      form: opened.container.querySelector("form") !== null,
      path: opened.path(),
    };
    opened.unmount();

    expect(after).toEqual({
      said: i18n.t("errors.field.TOO_COMMON"),
      focused: true,
      form: true,
      path: "/reset",
    });
  });
});

describe("an invitation", () => {
  it.each([
    {
      grant: TEACHER,
      shown: ["教师", "PROGETTAZIONE E PRODUZIONE MULTIMEDIALE · 2025-2026"],
      lands: "/staff/editions/5",
    },
    {
      grant: SECRETARIAT,
      shown: ["教学秘书", "INGEGNERIA INFORMATICA"],
      lands: "/staff/programmes/B047",
    },
  ])(
    "to $grant.role: named, an account made in the page's language, and on to its scope",
    async ({ grant, shown, lands }) => {
      answers["/api/auth/invitation/lookup"] = () => json(grant);
      await act(() => i18n.changeLanguage("zh-hans"));
      const opened = open(`/invite#${TOKEN}`, {});
      await settle();
      const head = opened.container.querySelector("form > div");
      const named = [...(head?.children ?? [])].map((part) => part.textContent);
      type(opened.container.querySelector<HTMLInputElement>("#username"), "demo-new");
      type(
        opened.container.querySelector<HTMLInputElement>("#password"),
        "cavallo batteria graffetta",
      );
      await send(opened.container);
      const after = { named, sent: sent[1], rechecked: opened.recheck.mock.calls.length };
      const path = opened.path();
      opened.unmount();

      expect({ ...after, path }).toEqual({
        named: shown,
        sent: {
          to: "/api/auth/invitation/accept",
          body: {
            token: TOKEN,
            username: "demo-new",
            password: "cavallo batteria graffetta",
            locale: "zh-hans",
          },
        },
        rechecked: 1,
        path: lands,
      });
    },
  );

  it("signed in: accepted as the account, named by its id", async () => {
    const opened = open(`/invite#${TOKEN}`, { account: READER });
    await settle();
    const offered = {
      as: opened.container.querySelector("form p.text-center")?.textContent,
      fields: opened.container.querySelectorAll("form input").length,
    };
    await send(opened.container);
    const after = { offered, sent: sent[1], path: opened.path() };
    opened.unmount();

    expect(after).toEqual({
      offered: { as: i18n.t("auth.acceptAs", { username: READER.username }), fields: 0 },
      sent: { to: "/api/auth/invitation/accept", body: { token: TOKEN, account: READER.id } },
      path: "/staff/editions/5",
    });
  });

  it.each([
    { meanwhile: "the session ended", read: null, offered: { as: undefined, username: true } },
    {
      meanwhile: "another account signed in",
      read: { ...READER, id: 4, username: "demo-other" },
      offered: { as: i18n.t("auth.acceptAs", { username: "demo-other" }), username: false },
    },
  ])("signed in, $meanwhile: said, and the session read again", async ({ read, offered }) => {
    answers["/api/auth/invitation/accept"] = refusal("UNAUTHENTICATED");
    const opened = open(`/invite#${TOKEN}`, { account: READER, recheck: async () => read });
    await settle();
    await send(opened.container);
    const after = {
      said: opened.container.querySelector('[role="alert"]')?.textContent,
      offered: {
        as: opened.container.querySelector("form p.text-center")?.textContent,
        username: opened.container.querySelector("#username") !== null,
      },
      path: opened.path(),
    };
    opened.unmount();

    expect(after).toEqual({ said: i18n.t("errors.UNAUTHENTICATED"), offered, path: "/invite" });
  });

  it("signed in as someone else: signing out is offered", async () => {
    const opened = open(`/invite#${TOKEN}`, { account: READER });
    await settle();
    const button = [...opened.container.querySelectorAll("button")].find(
      (candidate) => candidate.textContent === i18n.t("account.logOut"),
    );
    act(() => button?.click());
    const signedOut = opened.logOut.mock.calls.length;
    opened.unmount();

    expect(signedOut).toBe(1);
  });

  it.each([
    {
      refused: "a username taken",
      account: null,
      answer: refusal("INVALID_ARGUMENT", [
        { field: "username", reason: "ALREADY_EXISTS", data: {} },
      ]),
      shown: "#username-refused",
      said: i18n.t("errors.field.username.ALREADY_EXISTS"),
    },
    {
      refused: "a role held already",
      account: READER,
      answer: refusal("ROLE_ALREADY_HELD"),
      shown: "[role=alert]",
      said: i18n.t("errors.ROLE_ALREADY_HELD"),
    },
  ])("refused, $refused: said, and the link still works", async (case_) => {
    answers["/api/auth/invitation/accept"] = case_.answer;
    const opened = open(`/invite#${TOKEN}`, { account: case_.account });
    await settle();
    type(opened.container.querySelector<HTMLInputElement>("#username"), "demo-taken");
    type(
      opened.container.querySelector<HTMLInputElement>("#password"),
      "cavallo batteria graffetta",
    );
    await send(opened.container);
    const after = {
      said: opened.container.querySelector(case_.shown)?.textContent,
      form: opened.container.querySelector("form") !== null,
      rechecked: opened.recheck.mock.calls.length,
      path: opened.path(),
    };
    opened.unmount();

    expect(after).toEqual({ said: case_.said, form: true, rechecked: 0, path: "/invite" });
  });
});
