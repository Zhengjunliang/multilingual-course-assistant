// @vitest-environment jsdom

/**
 * When a visitor's thread goes: on signing in, up or out, and not on a reload.
 *
 * A thread carried into an account would be a visitor's questions filed under
 * somebody's name, and one left behind after signing out is the next reader's
 * of a shared computer. The provider is mounted for real against a fake server
 * at `fetch`.
 */

import { act } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { Account } from "@/api/account";
import { readVisitorThread, writeVisitorThread } from "@/features/chat/visitorThread";
import { mount } from "@/test/mount";
import { SessionProvider } from "./SessionProvider";
import { useSession } from "./useSession";

const ACCOUNT: Account = { id: 1, username: "ada", locale: "it", is_superuser: false, roles: [] };

const THREAD = [
  {
    key: "live-1",
    question: "Quando scadono le tasse?",
    answer: "Entro il 30 novembre.",
    citations: [],
    route: null,
    locale: "it",
    complete: true,
    failure: null,
  },
];

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

/** Whether `me` finds a session another tab opened. */
let signedInElsewhere = false;

/** Nobody is signed in until a login or a registration says otherwise. */
async function fakeAuth(input: RequestInfo | URL): Promise<Response> {
  const path = String(input);
  if (path === "/api/auth/logout") return new Response(null, { status: 204 });
  if (path === "/api/auth/login" || path === "/api/auth/register" || signedInElsewhere) {
    return json({ authenticated: true, user: ACCOUNT });
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

describe("a visitor's thread and the account", () => {
  beforeEach(() => {
    sessionStorage.clear();
    signedInElsewhere = false;
    vi.stubGlobal("fetch", fakeAuth);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it.each([
    ["signing in", () => session.logIn("ada", "secret")],
    ["signing up", () => session.register("ada", "secret", "it")],
    ["signing out", () => session.logOut()],
  ])("goes on %s", async (_, step) => {
    const page = mount(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await settle();
    writeVisitorThread(THREAD);

    await act(step);
    page.unmount();

    expect(readVisitorThread()).toEqual([]);
  });

  it("stays through a reload, which asks the server who is signed in", async () => {
    writeVisitorThread(THREAD);

    const page = mount(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await settle();
    const signedIn = session.account;
    page.unmount();

    expect(signedIn).toBeNull();
    expect(readVisitorThread()).toEqual(THREAD);
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

  it("takes a session another tab opened, which this tab cannot see on its own", async () => {
    const page = mount(
      <SessionProvider>
        <Probe />
      </SessionProvider>,
    );
    await settle();
    const before = session.account;
    writeVisitorThread(THREAD);
    signedInElsewhere = true;

    await act(() => session.recheck());
    const after = session.account;
    page.unmount();

    expect(before).toBeNull();
    expect(after?.username).toBe("ada");
    // Signing in elsewhere is still signing in: the thread is not carried over.
    expect(readVisitorThread()).toEqual([]);
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
