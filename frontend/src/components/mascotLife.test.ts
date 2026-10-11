/**
 * The living cat's behaviour, run frame by frame on a clock and dice of the
 * test's own: when it blinks, sleeps and wakes, what it does for the send
 * button and a sent question, and where it looks.
 */

import { describe, expect, it } from "vitest";

import { HEAD, outline } from "@/brand/fumetto";
import { born, hop, type Life, live, type Pose, poke, type Senses, STILL } from "./mascotLife";

const FRAME = 1 / 60;
const AWAY: Omit<Senses, "now" | "dt" | "random"> = { gaze: null, typing: false, cheer: false };

/** Runs the cat from `from` to `to` seconds and returns each frame's time and pose. */
function run(
  life: Life,
  from: number,
  to: number,
  senses: Partial<Senses> = {},
): { now: number; pose: Pose }[] {
  const frames = [];
  for (let now = from; now < to; now += FRAME) {
    const pose = live(life, { ...AWAY, now, dt: FRAME, random: () => 0.5, ...senses });
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
    expect(asleep?.eyes).toBe("asleep");
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

    expect(run(life, 0, 0.5, { cheer: true }).at(-1)?.pose.eyes).toBe("happy");
    expect(run(life, 0.5, 1).at(-1)?.pose.eyes).toBe("open");
  });

  it("hops once when a question is sent, smiling, and lands", () => {
    const life = born(0, () => 0.5);
    hop(life, 1);
    const frames = run(life, 1, 1.6);
    const highest = Math.min(...frames.map(({ pose }) => pose.hop));

    expect(highest).toBeLessThan(-4.5);
    expect(frames[10]?.pose.eyes).toBe("happy");
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
