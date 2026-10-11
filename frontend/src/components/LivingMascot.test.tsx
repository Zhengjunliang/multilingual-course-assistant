// @vitest-environment jsdom

/**
 * The living cat's frame: still for a reader who asked for reduced motion,
 * and stopped by a toggle that keeps its name and is remembered. What it does
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
  localStorage.clear();
});

describe("the living cat", () => {
  it("stands still at rest, with no frames asked for and no button, under reduced motion", () => {
    systemReducesMotion(true);
    const frames = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", frames);
    const { container, unmount } = mount(<LivingMascot />);
    const drawn = container.querySelector('[data-part="outline"]')?.getAttribute("d");
    const button = container.querySelector("button");
    unmount();

    expect({ drawn, button, frames: frames.mock.calls.length }).toEqual({
      drawn: HEAD,
      button: null,
      frames: 0,
    });
  });

  it("stops and starts from a toggle whose name stays the same, and remembers it", () => {
    systemReducesMotion(false);
    vi.stubGlobal(
      "requestAnimationFrame",
      vi.fn(() => 1),
    );
    const stop = vi.fn();
    vi.stubGlobal("cancelAnimationFrame", stop);
    const { container, unmount } = mount(<LivingMascot />);
    const button = () => container.querySelector("button");
    const state = () => ({
      pressed: button()?.getAttribute("aria-pressed"),
      name: button()?.getAttribute("aria-label"),
      stored: localStorage.getItem("mca.mascot"),
    });
    const playing = state();
    act(() => button()?.click());
    const paused = { ...state(), stopped: stop.mock.calls.length > 0 };
    unmount();

    expect({ playing, paused }).toEqual({
      playing: { pressed: "false", name: "Ferma l'animazione del gatto", stored: null },
      paused: {
        pressed: "true",
        name: "Ferma l'animazione del gatto",
        stored: "paused",
        stopped: true,
      },
    });
  });

  it("comes back paused when it was left paused", () => {
    systemReducesMotion(false);
    const frames = vi.fn(() => 1);
    vi.stubGlobal("requestAnimationFrame", frames);
    localStorage.setItem("mca.mascot", "paused");
    const { container, unmount } = mount(<LivingMascot />);
    const pressed = container.querySelector("button")?.getAttribute("aria-pressed");
    unmount();

    expect({ pressed, frames: frames.mock.calls.length }).toEqual({ pressed: "true", frames: 0 });
  });
});
