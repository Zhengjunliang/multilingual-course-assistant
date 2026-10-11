/**
 * What the living cat does from one frame to the next (#173): when it blinks,
 * flicks an ear, yawns and falls asleep, where its eyes go, how its ears, head
 * and tail follow. No DOM, no clock and no dice of its own: the caller hands
 * in the time, what the cat can see and a source of chance, so a test can run
 * it frame by frame. components/LivingMascot.tsx draws the pose it returns.
 *
 * Ported from the entry demo the author chose the behaviour on (#173), where
 * every number below was tuned by eye.
 */

import type { Turns } from "@/brand/fumetto";

/** A damped spring: ears and the head ease toward where they are sent. */
interface Spring {
  x: number;
  v: number;
  to: number;
}

const spring = (): Spring => ({ x: 0, v: 0, to: 0 });

function step(s: Spring, dt: number, stiffness = 140, damping = 12): void {
  s.v += (-stiffness * (s.x - s.to) - damping * s.v) * dt;
  s.x += s.v * dt;
}

const clamp = (x: number, low: number, high: number) => Math.max(low, Math.min(high, x));

/** Seconds. */
export const TIMING = {
  /** A blink comes every 2.4 to 6.4 s, and one in four is double. */
  blinkFrom: 2.4,
  blinkSpread: 4,
  doubleBlink: 0.25,
  blink: 0.16,
  secondBlink: 0.24,
  /** An ear flicks every 3 to 9 s. */
  flickFrom: 3,
  flickSpread: 6,
  /** With nobody moving, the eyes go back to the question box. */
  restGaze: 2,
  sleepAfter: 10,
  yawn: 1.4,
  hop: 0.42,
} as const;

export type Mode = "awake" | "yawning" | "asleep";

export interface Life {
  mode: Mode;
  modeSince: number;
  /** The last pointer, key or wheel event. */
  lastInput: number;
  nextBlink: number;
  blinkAt: number;
  double: boolean;
  nextFlick: number;
  hopAt: number;
  earLeft: Spring;
  earRight: Spring;
  tilt: Spring;
  whisker: Spring;
  eyeX: number;
  eyeY: number;
}

export function born(now: number, random: () => number): Life {
  return {
    mode: "awake",
    modeSince: now,
    lastInput: now,
    nextBlink: now + TIMING.blinkFrom * random(),
    blinkAt: -Infinity,
    double: false,
    nextFlick: now + TIMING.flickFrom + TIMING.flickSpread * random(),
    hopAt: -Infinity,
    earLeft: spring(),
    earRight: spring(),
    tilt: spring(),
    whisker: spring(),
    eyeX: 0,
    eyeY: 0,
  };
}

/** Someone moved, typed or scrolled: a sleeping cat wakes with a double blink. */
export function poke(life: Life, now: number): void {
  life.lastInput = now;
  if (life.mode === "awake") return;
  life.mode = "awake";
  life.modeSince = now;
  life.blinkAt = now;
  life.double = true;
  life.nextBlink = now + 2.5;
  life.earLeft.v -= 5;
  life.earRight.v -= 5;
}

/** The question was sent. */
export function hop(life: Life, now: number): void {
  poke(life, now);
  life.hopAt = now;
}

export interface Senses {
  now: number;
  /** Since the last frame; 0 draws the frame without moving anything. */
  dt: number;
  /** Where the eyes are drawn to, in CSS pixels from the face; `null` looks ahead. */
  gaze: { x: number; y: number } | null;
  /** The question box has focus: the ears perk, and the cat stays awake. */
  typing: boolean;
  /** The pointer is on the send button: happy eyes, a quick tail. */
  cheer: boolean;
  random: () => number;
}

export type Eyes = "open" | "happy" | "asleep";

export interface Pose {
  turns: Required<Turns>;
  /** Radians, toward the gaze. */
  tilt: number;
  /** A fraction of the size: about 1 % awake, more asleep. */
  breath: number;
  /** Grid units, upward negative. */
  hop: number;
  /** The open eyes' height, 1 open. */
  blink: number;
  eyes: Eyes;
  yawning: boolean;
  /** Grid units the eyes and pupils move by. */
  eyeX: number;
  eyeY: number;
  /** Radians. */
  whisker: number;
  /** Where each rising "z" is in its climb, 0 to 1; empty when awake. */
  zs: number[];
}

/** The cat at rest: what reduced motion and the paused cat show. */
export const STILL: Pose = {
  turns: { earLeft: 0, earRight: 0, tail: 0 },
  tilt: 0,
  breath: 0,
  hop: 0,
  blink: 1,
  eyes: "open",
  yawning: false,
  eyeX: 0,
  eyeY: 0,
  whisker: 0,
  zs: [],
};

/** Moves the cat on by one frame and says how to draw it. */
export function live(life: Life, senses: Senses): Pose {
  const { now, dt, gaze, typing, cheer, random } = senses;

  if (life.mode === "awake" && now - life.lastInput > TIMING.sleepAfter && !typing) {
    life.mode = "yawning";
    life.modeSince = now;
  }
  if (life.mode === "yawning" && now - life.modeSince > TIMING.yawn) {
    life.mode = "asleep";
    life.modeSince = now;
  }
  const asleep = life.mode === "asleep";
  const yawning = life.mode === "yawning";
  const sinceYawn = now - life.modeSince;

  let blink = 1;
  if (life.mode === "awake") {
    if (now > life.nextBlink) {
      life.blinkAt = now;
      life.double = random() < TIMING.doubleBlink;
      life.nextBlink = now + TIMING.blinkFrom + TIMING.blinkSpread * random();
    }
    const since = now - life.blinkAt;
    const closing = (t: number) => 1 - Math.sin((t / TIMING.blink) * Math.PI) * 0.92;
    if (since < TIMING.blink) blink = closing(since);
    else if (
      life.double &&
      since > TIMING.secondBlink &&
      since < TIMING.secondBlink + TIMING.blink
    ) {
      blink = closing(since - TIMING.secondBlink);
    }
    if (now > life.nextFlick) {
      (random() < 0.5 ? life.earLeft : life.earRight).v += 6;
      life.whisker.v += (random() - 0.5) * 6;
      life.nextFlick = now + TIMING.flickFrom + TIMING.flickSpread * random();
    }
  }

  const gx = gaze?.x ?? 0;
  const gy = gaze?.y ?? 0;
  const ears = asleep ? 0.18 : yawning ? 0.12 : typing ? -0.07 : 0;
  life.earLeft.to = ears;
  life.earRight.to = ears;
  life.tilt.to = asleep ? 0.08 : clamp(gx / 480, -1, 1) * 0.12;
  step(life.earLeft, dt);
  step(life.earRight, dt);
  step(life.whisker, dt);
  step(life.tilt, dt, 40, 10);

  const follow = dt === 0 ? 1 : Math.min(1, dt * 9);
  life.eyeX += (clamp(gx / 260, -1, 1) * 2 - life.eyeX) * follow;
  life.eyeY += (clamp(gy / 260, -1, 1) * 1.1 - life.eyeY) * follow;

  const hopped = (now - life.hopAt) / TIMING.hop;
  const hopping = hopped >= 0 && hopped < 1;
  const happy = cheer || hopping;

  return {
    turns: {
      earLeft: -life.earLeft.x,
      earRight: life.earRight.x,
      tail: asleep
        ? 0.07 * Math.sin(now * 0.9)
        : happy
          ? 0.3 * Math.sin(now * 7.5)
          : 0.13 * Math.sin(now * 1.7) + 0.05 * Math.sin(now * 0.61),
    },
    tilt: life.tilt.x,
    breath: asleep ? 0.024 * Math.sin(now * 1.35) : 0.01 * Math.sin(now * 2),
    hop: hopping ? -Math.sin(hopped * Math.PI) * 5 : 0,
    blink,
    eyes: asleep || (yawning && sinceYawn > 0.15) ? "asleep" : happy ? "happy" : "open",
    yawning: yawning && sinceYawn > 0.15 && sinceYawn < 1.15,
    eyeX: life.eyeX,
    eyeY: life.eyeY,
    whisker: life.whisker.x,
    zs: asleep ? [0, 1, 2].map((i) => (now * 0.42 + i / 3) % 1) : [],
  };
}
