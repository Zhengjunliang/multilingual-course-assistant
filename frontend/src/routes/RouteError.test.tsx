// @vitest-environment jsdom

/**
 * The error screens, asked of the whole application: a page that throws
 * inside the frame, the frame itself, a visitor's page, and a provider
 * outside the router. Each time the reader must get the panel that says so,
 * with the ways on, never a blank window; inside the frame, the frame must
 * still stand, and moving on must clear the error.
 *
 * The pages that throw are the real ones behind a switch: the chat throws on
 * `/c/13` or when told to, and the frame throws when told to.
 *
 * One failure must not reach the panel: KaTeX's chunk, which the answer falls
 * back from to its untypeset text (AnswerStream.tsx). Here it never loads.
 * Only a live render can tell: a string render draws the fallback either way.
 */

import { act } from "react";
import { createMemoryRouter, RouterProvider } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import { routes } from "@/App";
import type { Account } from "@/api/account";
import { SessionContext } from "@/auth/SessionProvider";
import { AppCrash } from "@/components/AppCrash";
import { AnswerStream } from "@/features/chat/AnswerStream";
import i18n from "@/i18n";
import { type Mounted, mount } from "@/test/mount";
import { ThemeProvider } from "@/theme/ThemeProvider";

const breaks = vi.hoisted(() => ({ chat: false, frame: false }));

vi.mock("@/routes/ChatPage", async () => {
  const { useParams } = await import("react-router-dom");
  return {
    default: function ChatPage() {
      const { conversationId } = useParams();
      if (breaks.chat || conversationId === "13") throw new Error("drawn wrong");
      return <main data-chat />;
    },
  };
});

vi.mock("@/routes/ShellLayout", async (importOriginal) => {
  const { default: Frame } = await importOriginal<typeof import("@/routes/ShellLayout")>();
  return {
    default: function ShellLayout() {
      if (breaks.frame) throw new Error("drawn wrong");
      return <Frame />;
    },
  };
});

vi.mock("@/features/chat/MathMarkdown", () => {
  throw new Error("chunk failed to load");
});

const STUDENT: Account = {
  id: 1,
  username: "junliang",
  locale: "it",
  is_superuser: false,
  roles: [],
};

const ACTIONS = {
  logIn: async () => {},
  register: async () => {},
  logOut: async () => {},
  chooseLocale: async () => {},
  forget: () => {},
  recheck: async () => {},
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

async function fakeApi(input: RequestInfo | URL): Promise<Response> {
  if (String(input) === "/api/conversations") return json([]);
  return json({ detail: "Not found." }, 404);
}

function at(path: string, account: Account | null = STUDENT): Mounted {
  return mount(
    <ThemeProvider>
      <SessionContext value={{ account, ...ACTIONS }}>
        <RouterProvider router={createMemoryRouter(routes, { initialEntries: [path] })} />
      </SessionContext>
    </ThemeProvider>,
  );
}

async function settle() {
  for (let turn = 0; turn < 3; turn += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

/** What the panel offers, read off the page: its words, and where each way on leads. */
function panel(root: ParentNode) {
  const shown = root.querySelector("[data-status-panel]");
  if (shown === null) return null;
  return {
    alert: shown.querySelector('[role="alert"]')?.textContent,
    reload: shown.querySelector("button")?.textContent,
    home: shown.querySelector("a")?.getAttribute("href"),
  };
}

const PANEL = {
  alert: `${i18n.t("crash.title")}${i18n.t("crash.body")}`,
  reload: i18n.t("crash.reload"),
  home: "/",
};

let consoleError: MockInstance<typeof console.error>;

beforeEach(() => {
  breaks.chat = false;
  breaks.frame = false;
  vi.stubGlobal("fetch", fakeApi);
  // React and the router report each caught error; the cases read those reports.
  consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  consoleError.mockRestore();
});

/** Whether the error a page threw reached the console. */
function reported(): boolean {
  return consoleError.mock.calls.some((args) =>
    args.some((arg) => arg instanceof Error && arg.message === "drawn wrong"),
  );
}

describe("a page that throws", () => {
  it("inside the frame gives way to the panel, with the sidebar still there", async () => {
    const { container, unmount } = at("/c/13");
    await settle();
    const seen = {
      panel: panel(container),
      inMain: container.querySelector("main [data-status-panel]") !== null,
      sidebar: container.querySelector("aside nav") !== null,
      reported: reported(),
    };
    unmount();

    expect(seen).toEqual({ panel: PANEL, inMain: true, sidebar: true, reported: true });
  });

  it("leaves with the reader, who can open another page from the sidebar", async () => {
    const { container, unmount } = at("/c/13");
    await settle();
    act(() => container.querySelector<HTMLAnchorElement>('aside a[href="/"]')?.click());
    await settle();
    const seen = {
      panel: panel(container),
      chat: container.querySelector("[data-chat]") !== null,
    };
    unmount();

    expect(seen).toEqual({ panel: null, chat: true });
  });

  it("on a visitor's / gives way to the panel, with the ways to an account still there", async () => {
    breaks.chat = true;
    const { container, unmount } = at("/", null);
    await settle();
    const seen = {
      panel: panel(container),
      links: [...container.querySelectorAll("header a")].map((a) => a.getAttribute("href")),
    };
    unmount();

    expect(seen).toEqual({ panel: PANEL, links: ["/login", "/register"] });
  });
});

describe("a frame that throws", () => {
  it("covers the window with the panel", async () => {
    breaks.frame = true;
    const { container, unmount } = at("/");
    await settle();
    const seen = {
      panel: panel(container),
      sidebar: container.querySelector("aside"),
      reported: reported(),
    };
    unmount();

    expect(seen).toEqual({ panel: PANEL, sidebar: null, reported: true });
  });
});

describe("a provider that throws", () => {
  function Provider(): never {
    throw new Error("drawn wrong");
  }

  it("leaves the panel on the window, with a plain link home", () => {
    const { container, unmount } = mount(
      <AppCrash>
        <Provider />
      </AppCrash>,
    );
    const seen = { panel: panel(container), reported: reported() };
    unmount();

    expect(seen).toEqual({ panel: PANEL, reported: true });
  });
});

describe("a chunk that fails to load", () => {
  it("leaves the answer on screen, untypeset, rather than throwing", async () => {
    const { container, unmount } = mount(
      <AnswerStream
        text="Vedi $$x^2$$."
        badges={[]}
        complete
        live={false}
        onBadgeClick={() => {}}
      />,
    );
    await settle();
    const seen = {
      text: container.textContent,
      math: container.querySelector(".language-math") !== null,
      typeset: container.querySelector(".katex") !== null,
    };
    unmount();

    expect(seen).toEqual({ text: "Vedi x^2.", math: true, typeset: false });
  });
});
