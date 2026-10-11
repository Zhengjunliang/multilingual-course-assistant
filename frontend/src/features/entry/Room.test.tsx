// @vitest-environment jsdom

/**
 * The room behind the entry screens: drawn in on the first screen of a page
 * load only, and moved by the pointer only where motion is allowed and the
 * device can hover. That nothing in it moves under reduced motion is read in
 * a browser, by frontend/e2e/motion.spec.ts; where its lines fall, by the
 * acceptance of #183.
 */

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
