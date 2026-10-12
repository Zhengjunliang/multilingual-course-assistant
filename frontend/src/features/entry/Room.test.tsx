// @vitest-environment jsdom

/**
 * The room behind the entry screens: drawn in on the first screen of a page
 * load only, and moved by the pointer only where motion is allowed and the
 * device can hover. That nothing in it moves under reduced motion is read in
 * a browser, by frontend/e2e/motion.spec.ts; where its lines fall, by the
 * acceptance of #183.
 */

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { mount } from "@/test/mount";
import { Room } from "./Room";

/** What `matchMedia` answers: reduced motion, and a device that can hover or not. */
function system({ reduce, hover }: { reduce: boolean; hover: boolean }) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: query.includes("reduce") ? reduce : query.includes("hover: none") ? !hover : false,
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("the room", () => {
  it("draws itself in on the first screen of a page load, and is there whole after", () => {
    system({ reduce: false, hover: true });
    const first = mount(<Room clear="25rem" />);
    const drawsFirst = first.container.querySelector(".room-draw") !== null;
    first.unmount();
    const second = mount(<Room clear="48rem" />);
    const drawsAgain = second.container.querySelector(".room-draw") !== null;
    second.unmount();

    expect({ drawsFirst, drawsAgain }).toEqual({ drawsFirst: true, drawsAgain: false });
  });

  it("drops the dash once the last line is in, so a wing resized later stays whole", async () => {
    system({ reduce: false, hover: true });
    vi.resetModules();
    const { Room: Fresh } = await import("./Room");
    const { container, unmount } = mount(<Fresh clear="25rem" />);
    const lines = container.querySelectorAll("path");
    // jsdom has no `AnimationEvent`, and React then listens for the prefixed
    // name instead, so both are sent (as ChatPage.routing.test.tsx does).
    const end = (line: Element | undefined) =>
      act(() => {
        for (const name of ["animationend", "webkitAnimationEnd"]) {
          const done = Object.assign(new Event(name, { bubbles: true }), {
            animationName: "room-line",
          });
          line?.dispatchEvent(done);
        }
      });
    end(lines[0]);
    const afterFirst = container.querySelector(".room-draw") !== null;
    end(lines[lines.length - 1]);
    const afterLast = container.querySelector(".room-draw") !== null;
    unmount();

    expect({ afterFirst, afterLast }).toEqual({ afterFirst: true, afterLast: false });
  });

  it.each([
    { reduce: false, hover: true, follows: true },
    { reduce: true, hover: true, follows: false },
    { reduce: false, hover: false, follows: false },
  ])(
    "follows the pointer: $follows, with reduced motion $reduce and hover $hover",
    ({ reduce, hover, follows }) => {
      system({ reduce, hover });
      const listen = vi.spyOn(window, "addEventListener");
      const { unmount } = mount(<Room clear="25rem" />);
      const listened = listen.mock.calls.some(([type]) => type === "pointermove");
      unmount();

      expect(listened).toBe(follows);
    },
  );
});
