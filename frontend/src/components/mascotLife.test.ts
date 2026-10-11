/**
 * The living cat's behaviour, run frame by frame on a clock and dice of the
 * test's own: when it blinks, sleeps and wakes, what it does for the send
 * button and a sent question, where it looks, and how it answers a sign-in
 * form.
 */

import { describe, expect, it } from "vitest";

import { HEAD, outline } from "@/brand/fumetto";
import {
  born,
  frown,
  glance,
  glancing,
  hop,
  type Life,
  live,
  type Pose,
  poke,
  type Senses,
  STILL,
  TIMING,
  welcome,
} from "./mascotLife";

const FRAME = 1 / 60;
const NOTHING: Omit<Senses, "now" | "dt" | "random"> = {
  gaze: null,
  typing: false,
  cheer: false,
  away: false,
  peek: false,
  busy: false,
};
const OPEN = { left: "open", right: "open" };
const HAPPY = { left: "happy", right: "happy" };

/** Runs the cat from `from` to `to` seconds and returns each frame's time and pose. */
function run(
  life: Life,
  from: number,
  to: number,
  senses: Partial<Senses> = {},
): { now: number; pose: Pose }[] {
  const frames = [];
  for (let now = from; now < to; now += FRAME) {
    const pose = live(life, { ...NOTHING, now, dt: FRAME, random: () => 0.5, ...senses });
    frames.push({ now, pose });
  }
  return frames;
}

/** The times at which the open eyes start to close. */
function blinks(frames: { now: number; pose: Pose }[]): number[] {
  return frames.flatMap(({ now, pose }, i) =>
    pose.blink < 1 && (i === 0 || (frames[i - 1]?.pose.blink ?? 1) === 1) ? [now] : [],
  );
}

describe("the living cat", () => {
  it("draws at rest exactly the head the brand files hold", () => {
    expect(outline(STILL.turns)).toBe(HEAD);
  });

  it("blinks every 2.4 to 6.4 seconds while awake", () => {
    const life = born(0, () => 0.5);
    const starts = blinks(run(life, 0, 30, { typing: true }));
    const gaps = starts.slice(1).map((at, i) => at - (starts[i] ?? 0));

    expect(gaps.length).toBeGreaterThan(4);
    expect(gaps.every((gap) => gap >= 2.4 && gap <= 6.4)).toBe(true);
  });

  it("yawns after ten idle seconds, then sleeps, and wakes with a double blink", () => {
    const life = born(0, () => 0.5);
    run(life, 0, 10.5);
    const yawning = life.mode;
    const asleep = run(life, 10.5, 12.5).at(-1)?.pose;
    poke(life, 12.5);
    const woken = blinks(run(life, 12.5, 13.2));

    expect(yawning).toBe("yawning");
    expect(asleep?.eyes).toEqual({ left: "shut", right: "shut" });
    expect(asleep?.zs).toHaveLength(3);
    expect(life.mode).toBe("awake");
    expect(woken).toHaveLength(2);
  });

  it("stays awake while the question box has focus, ears perked", () => {
    const life = born(0, () => 0.5);
    const last = run(life, 0, 20, { typing: true }).at(-1)?.pose;

    expect(life.mode).toBe("awake");
    expect(last?.turns.earRight).toBeLessThan(0);
  });

  it("smiles while the pointer is on the send button", () => {
    const life = born(0, () => 0.5);

    expect(run(life, 0, 0.5, { cheer: true }).at(-1)?.pose.eyes).toEqual(HAPPY);
    expect(run(life, 0.5, 1).at(-1)?.pose.eyes).toEqual(OPEN);
  });

  it("hops once when a question is sent, smiling, and lands", () => {
    const life = born(0, () => 0.5);
    hop(life, 1);
    const frames = run(life, 1, 1.6);
    const highest = Math.min(...frames.map(({ pose }) => pose.hop));

    expect(highest).toBeLessThan(-4.5);
    expect(frames[10]?.pose.eyes).toEqual(HAPPY);
    expect(frames.at(-1)?.pose.hop).toBe(0);
  });

  it("looks and leans toward what draws its eyes, and ahead when nothing does", () => {
    const life = born(0, () => 0.5);
    const right = run(life, 0, 2, { gaze: { x: 400, y: 0 } }).at(-1)?.pose;
    const ahead = run(life, 2, 4).at(-1)?.pose;

    expect(right?.eyeX).toBeCloseTo(2, 1);
    expect(right?.tilt).toBeGreaterThan(0.05);
    expect(ahead?.eyeX).toBeCloseTo(0, 1);
  });
});

describe("the living cat on a sign-in form", () => {
  it("shuts its eyes and turns aside while a password is typed, and stays awake", () => {
    const life = born(0, () => 0.5);
    const last = run(life, 0, 20, { away: true }).at(-1)?.pose;

    expect(life.mode).toBe("awake");
    expect(last?.eyes).toEqual({ left: "shut", right: "shut" });
    expect(last?.tilt).toBeGreaterThan(0.15);
  });

  it("opens one eye while the letters are shown", () => {
    const life = born(0, () => 0.5);

    expect(run(life, 0, 1, { away: true, peek: true }).at(-1)?.pose.eyes).toEqual({
      left: "shut",
      right: "open",
    });
  });

  it("shakes its head with drooping lids and a flat mouth when refused, then looks away again", () => {
    const life = born(0, () => 0.5);
    run(life, 0, 1, { away: true });
    frown(life, 1);
    const shaking = run(life, 1, 1 + TIMING.shake, { away: true });
    const tilts = shaking.map(({ pose }) => pose.tilt);
    const after = run(life, 1 + TIMING.shake, 1 + TIMING.frown + 0.1, { away: true }).at(-1)?.pose;

    expect(shaking[5]?.pose.eyes).toEqual({ left: "droop", right: "droop" });
    expect(shaking[5]?.pose.mouth).toBe("flat");
    expect(Math.max(...tilts) - Math.min(...tilts)).toBeGreaterThan(0.15);
    expect(after?.eyes).toEqual({ left: "shut", right: "shut" });
    expect(after?.mouth).toBe("smile");
  });

  it("watches a form being sent rather than looking away, and does not sleep", () => {
    const life = born(0, () => 0.5);
    const last = run(life, 0, 15, { away: true, busy: true }).at(-1)?.pose;

    expect(life.mode).toBe("awake");
    expect(last?.eyes).toEqual(OPEN);
  });

  it("glances at each field a password manager fills, one after the other, smiling", () => {
    const life = born(0, () => 0.5);
    glance(life, 1);
    const smile = run(life, 1, 1.1).at(-1)?.pose.eyes;

    expect(smile).toEqual(HAPPY);
    expect([0.1, 0.5, 1].map((after) => glancing(life, 1 + after))).toEqual([0, 1, null]);
  });

  it("lands on the entry smiling, for a moment", () => {
    const life = born(0, () => 0.5);
    welcome(life, 1);

    expect(run(life, 1, 2).at(-1)?.pose.eyes).toEqual(HAPPY);
    expect(run(life, 2, 2.6).at(-1)?.pose.eyes).toEqual(OPEN);
  });
});
