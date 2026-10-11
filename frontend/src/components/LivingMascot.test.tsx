// @vitest-environment jsdom

/**
 * The living cat's frame: still for a reader who asked for reduced motion, a
 * hop only for a question sent while it stands there, and the eyes it draws
 * for a password field marked on the page. What it does
 * from frame to frame is mascotLife.test.ts; that it moves on a real screen
 * is read in a browser, by frontend/e2e/motion.spec.ts.
 */

import { act } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { HEAD } from "@/brand/fumetto";
import { mount } from "@/test/mount";
import { LivingMascot } from "./LivingMascot";

/** The system's reduced-motion setting, as `matchMedia` answers it. */
function systemReducesMotion(reduce: boolean) {
  vi.spyOn(window, "matchMedia").mockImplementation(
    (query) =>
      ({
        matches: reduce && query.includes("reduce"),
        media: query,
        addEventListener: () => {},
        removeEventListener: () => {},
      }) as unknown as MediaQueryList,
  );
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("the living cat", () => {
  it("stands still at rest, with no frames asked for, under reduced motion", () => {
    systemReducesMotion(true);
    const frames = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", frames);
    const { container, unmount } = mount(<LivingMascot />);
    const drawn = container.querySelector('[data-part="outline"]')?.getAttribute("d");
    unmount();

    expect({ drawn, frames: frames.mock.calls.length }).toEqual({ drawn: HEAD, frames: 0 });
  });

  it("hops for a question sent while it stands there, not for one sent before it appeared", () => {
    systemReducesMotion(false);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => frames.push(callback)),
    );
    const { container, unmount } = mount(<LivingMascot hops={1} />);
    const body = () => container.querySelector('[data-part="body"]')?.getAttribute("transform");
    const run = () =>
      act(() => {
        for (const frame of frames.splice(0)) frame(performance.now());
      });
    run();
    run();
    const lifted = body()?.match(/^translate\(0 (-?[\d.]+)\)/)?.[1];
    unmount();

    expect(Number(lifted)).toBe(0);
  });

  it("shuts both eyes while a password field has the focus, and opens one while its letters show", () => {
    systemReducesMotion(false);
    const frames: FrameRequestCallback[] = [];
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn((callback: FrameRequestCallback) => frames.push(callback)),
    );
    const { container, unmount } = mount(
      <>
        <div data-mascot-away>
          <input type="password" />
        </div>
        <LivingMascot />
      </>,
    );
    const field = container.querySelector("input");
    const run = () =>
      act(() => {
        for (const frame of frames.splice(0)) frame(performance.now());
      });
    const drawn = (side: string) =>
      ["open", "droop", "happy", "shut"].filter(
        (eye) =>
          container.querySelector(`[data-part="${eye}-${side}"]`)?.getAttribute("display") !==
          "none",
      );
    act(() => field?.focus());
    run();
    run();
    const away = { left: drawn("left"), right: drawn("right") };
    if (field !== null) field.type = "text";
    run();
    const peek = { left: drawn("left"), right: drawn("right") };
    unmount();

    expect({ away, peek }).toEqual({
      away: { left: ["shut"], right: ["shut"] },
      peek: { left: ["shut"], right: ["open"] },
    });
  });
});
