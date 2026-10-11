// @vitest-environment jsdom

/**
 * The living cat's frame: still for a reader who asked for reduced motion, and
 * a hop only for a question sent while it stands there. What it does
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
});
