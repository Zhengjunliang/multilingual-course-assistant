// @vitest-environment jsdom

/**
 * The account the provider follows: the language it brings, and a session
 * opened in another tab. The provider is mounted for real against a fake
 * server at `fetch`.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/api/account";
import i18n from "@/i18n";
import { mount } from "@/test/mount";
import { SessionProvider } from "./SessionProvider";
import { useSession } from "./useSession";

const ACCOUNT: Account = { id: 1, username: "ada", locale: "it", is_superuser: false, roles: [] };

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Whether `me` finds a session another tab opened. */
let signedInElsewhere = false;
/** The account a login or a registration signs in. */
let account: Account = ACCOUNT;

/** Nobody is signed in until a login or a registration says otherwise. */
async function fakeAuth(input: RequestInfo | URL): Promise<Response> {
  const path = String(input);
  if (path === "/api/auth/logout") return new Response(null, { status: 204 });
  if (path === "/api/auth/login" || path === "/api/auth/register" || signedInElsewhere) {
    return json({ authenticated: true, user: account });
  }
  return json({ authenticated: false, user: null });
}

let session: ReturnType<typeof useSession>;

function Probe() {
  session = useSession();
  return null;
}

async function settle() {
  for (let round = 0; round < 3; round += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

describe("the interface language and the account", () => {
  beforeEach(() => {
    account = { ...ACCOUNT, locale: "en" };
    localStorage.clear();
    vi.stubGlobal("fetch", fakeAuth);
  });

  afterEach(async () => {
    vi.unstubAllGlobals();
    account = ACCOUNT;
    localStorage.clear();
    await i18n.changeLanguage("it");
  });

  it("takes the account's language, remembers it, and keeps it after signing out", async () => {
    const page = mount(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await settle();
    await act(() => session.logIn("ada", "secret"));
    const signedIn = [i18n.language, localStorage.getItem("mca.locale")];
    await act(() => session.logOut());
    const signedOut = [i18n.language, localStorage.getItem("mca.locale")];
    page.unmount();

    expect({ signedIn, signedOut }).toEqual({ signedIn: ["en", "en"], signedOut: ["en", "en"] });
  });
});

describe("asking the server again", () => {
  beforeEach(() => {
    signedInElsewhere = false;
    vi.stubGlobal("fetch", fakeAuth);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it.each([
    {
      takes: "a session another tab opened, which this tab cannot see on its own",
      before: null,
      after: ACCOUNT,
    },
    {
      takes: "a role the account signed in was given, by an invitation it accepted",
      before: ACCOUNT,
      after: { ...ACCOUNT, roles: [{ role: "teacher", edition: 5 }] } satisfies Account,
    },
  ])("takes $takes", async ({ before, after }) => {
    signedInElsewhere = before !== null;
    account = before ?? ACCOUNT;
    const page = mount(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await settle();
    const first = session.account;
    signedInElsewhere = true;
    account = after;

    await act(() => session.recheck());
    const later = session.account;
    page.unmount();
    account = ACCOUNT;

    expect({ first, later }).toEqual({ first: before, later: after });
  });

  it("asks when the tab comes back into view, before the next question is typed", async () => {
    const page = mount(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await settle();
    signedInElsewhere = true;
    vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");

    act(() => {
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await settle();
    const after = session.account;
    page.unmount();

    expect(after?.username).toBe("ada");
  });
});
